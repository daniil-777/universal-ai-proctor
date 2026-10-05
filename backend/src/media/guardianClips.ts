import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import pLimit from "p-limit";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "../domain/session.js";
import { referenceKey, syncReview, type ReviewEvent } from "../domain/review.js";
import { guardianClipWindow, guardianIncidentEligible, GUARDIAN_WINDOW } from "./guardianFindings.js";
import { probeVideo } from "../pipeline/frames.js";
export { guardianClipWindow, guardianIncidentEligible } from "./guardianFindings.js";

const bundled = ffmpegStatic as unknown as string | null;
const ffmpeg = process.env.FFMPEG_PATH || (bundled && existsSync(bundled) ? bundled : "ffmpeg");
const encodeLimit = pLimit(2);
const globalEntries = new Set<Entry>();
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const abortError = () => fail("Clip preparation was cancelled.", 499);

export const GUARDIAN_CLIP_LIMITS = Object.freeze({ ...GUARDIAN_WINDOW, clips_per_app: 8, clips_global: 32, ttl_ms: 600_000, timeout_ms: 30_000, bytes_per_clip: 16 * 1024 * 1024 });
export interface GuardianClipGuard { source_id: string; reference_key: string }
interface Context { session: Session; event: ReviewEvent; path: string; source: string; generation: number; reference: string; start_s: number; end_s: number }
function contextFor(session: Session, id: string, guard: GuardianClipGuard): Context {
  const review = syncReview(session);
  if (session.disposed || !guard.source_id || guard.source_id !== session.sourceId || guard.reference_key !== review.reference_key)
    throw fail("Input or guidance reference changed. Refresh the report before preparing this clip.", 409);
  const event = review.events.find(item => item.id === id && item.source_id === session.sourceId);
  if (!event) throw fail("This incident is no longer retained in the current session.", 404);
  if (!guardianIncidentEligible(event)) throw fail("Clips are available for retained, non-demo Guardian concerns from a current-frame observation.", 400);
  if (session.sourceKind !== "video" || !session.videoPath) throw fail("A server copy of the original video is needed for this incident clip. Camera and screen samples do not contain recorded footage.", 404);
  const window = guardianClipWindow(event.video_time_s, session.videoInfo?.duration ?? 0);
  return { session, event: { ...event, step_ids: [...event.step_ids] }, path: session.videoPath, source: session.sourceId, generation: session.mediaGeneration, reference: review.reference_key, ...window };
}
function contextCurrent(context: Context) {
  const session = context.session;
  return !session.disposed && session.sourceId === context.source && session.videoPath === context.path && session.mediaGeneration === context.generation
    && referenceKey(session) === context.reference && !!session.review?.events.some(event => event.id === context.event.id && event.source_id === context.source && event.video_time_s === context.event.video_time_s && guardianIncidentEligible(event));
}
interface EncodedClip { file: string; cleanup: () => Promise<void> }
type Extractor = (context: { path: string; start_s: number; end_s: number }, signal: AbortSignal) => Promise<EncodedClip>;

/** Re-encoding starts at the requested decoded frame, unlike keyframe-aligned stream copy. */
export const extractGuardianClip: Extractor = (context, signal) => encodeLimit(async () => {
  if (signal.aborted) throw signal.reason || abortError();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "process-guide-guardian-")), file = path.join(directory, "incident.mp4");
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(context.start_s), "-i", context.path, "-t", String(context.end_s - context.start_s), "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-b:a", "96k", "-fs", String(GUARDIAN_CLIP_LIMITS.bytes_per_clip + 1), "-movflags", "+faststart", file];
      const process = spawn(ffmpeg, args, { windowsHide: true });
      let diagnostics = "", settled = false, terminationError: unknown;
      const finish = (error?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
      const abort = () => { terminationError = signal.reason || abortError(); process.kill("SIGKILL"); };
      const timer = setTimeout(() => { terminationError = fail("Clip preparation timed out. Try again with the uploaded video.", 504); process.kill("SIGKILL"); }, GUARDIAN_CLIP_LIMITS.timeout_ms);
      timer.unref();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      process.stderr.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-1000); });
      process.on("error", error => finish(error));
      process.on("close", code => finish(terminationError || (code === 0 ? undefined : fail(`Unable to prepare the incident clip: ${diagnostics.slice(-240)}`, 502))));
    });
    if (signal.aborted) throw signal.reason || abortError();
    const size = (await fs.stat(file)).size;
    if (!size || size > GUARDIAN_CLIP_LIMITS.bytes_per_clip) throw fail("The incident clip exceeds the export size limit.", 413);
    const info = await probeVideo(file);
    if (!info.width || !info.height || !info.duration || Math.abs(info.duration - (context.end_s - context.start_s)) > 0.15)
      throw fail("The incident clip could not preserve the complete requested window. Try preparing it again.", 502);
    if (signal.aborted) throw signal.reason || abortError();
    return { file, cleanup };
  } catch (error) { await cleanup(); throw error; }
});

interface Entry { owner: GuardianClipCache; key: string; context: Context; controller: AbortController; pending: Promise<EncodedClip>; result?: EncodedClip; consumers: number; expires: number; touched: number; removed: boolean }
export interface GuardianClipLease { file: string; start_s: number; end_s: number; old_reference: boolean; release: () => void }
function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(signal.reason || abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason || abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/** Shared encoding, pinned stream leases, bounded LRU storage and source-aware invalidation. */
export class GuardianClipCache {
  private entries = new Map<string, Entry>();
  private closed = false;
  private readonly sweepTimer: NodeJS.Timeout;
  private readonly cleanupTasks = new Set<Promise<unknown>>();
  constructor(private options: { extract?: Extractor; now?: () => number; ttl_ms?: number; max?: number } = {}) {
    this.sweepTimer = setInterval(() => this.sweep(), 1000); this.sweepTimer.unref();
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private remove(entry: Entry, reason?: Error) {
    if (entry.removed) return;
    entry.removed = true; this.entries.delete(entry.key); globalEntries.delete(entry);
    if (!entry.result) entry.controller.abort(reason || abortError());
    const cleanup = entry.pending.then(result => result.cleanup(), () => undefined).catch(() => undefined);
    this.cleanupTasks.add(cleanup); void cleanup.finally(() => this.cleanupTasks.delete(cleanup));
  }
  sweep() {
    for (const entry of this.entries.values()) {
      const current = contextCurrent(entry.context);
      if (!current && !entry.result) this.remove(entry, fail("Input, reference or retained incident changed while preparing the clip.", 409));
      else if (!entry.consumers && (!current || entry.expires <= this.now())) this.remove(entry);
    }
  }
  private makeRoom() {
    this.sweep();
    for (const entry of globalEntries) if (!entry.consumers && (entry.expires <= entry.owner.now() || !contextCurrent(entry.context))) entry.owner.remove(entry);
    const oldest = (entries: Iterable<Entry>) => [...entries].filter(entry => !entry.consumers).sort((a, b) => a.touched - b.touched)[0];
    if (this.entries.size >= (this.options.max ?? GUARDIAN_CLIP_LIMITS.clips_per_app)) { const entry = oldest(this.entries.values()); if (!entry) throw fail("Incident clips are busy. Close a preview and try again.", 429); this.remove(entry); }
    if (globalEntries.size >= GUARDIAN_CLIP_LIMITS.clips_global) { const entry = oldest(globalEntries); if (!entry) throw fail("Incident clip capacity is busy. Try again shortly.", 429); entry.owner.remove(entry); }
  }
  async acquire(session: Session, id: string, guard: GuardianClipGuard, signal?: AbortSignal): Promise<GuardianClipLease> {
    if (this.closed) throw fail("Incident clip service is closed.", 503);
    if (signal?.aborted) throw signal.reason || abortError();
    const context = contextFor(session, id, guard), key = JSON.stringify([session.id, context.source, context.path, context.generation, context.reference, id, context.start_s, context.end_s]);
    this.sweep(); let entry = this.entries.get(key);
    if (!entry) {
      this.makeRoom(); const controller = new AbortController();
      entry = { owner: this, key, context, controller, pending: Promise.resolve(undefined as never), consumers: 0, expires: Infinity, touched: this.now(), removed: false };
      const item = entry;
      item.pending = Promise.resolve().then(() => (this.options.extract || extractGuardianClip)(context, controller.signal)).then(result => { item.result = result; item.expires = this.now() + (this.options.ttl_ms ?? GUARDIAN_CLIP_LIMITS.ttl_ms); return result; });
      // A failed shared encode must leave neither a cache key nor an unhandled rejection.
      void item.pending.catch(() => this.remove(item));
      this.entries.set(key, item); globalEntries.add(item);
    }
    const item = entry; item.consumers++; item.touched = this.now();
    let released = false;
    const release = () => { if (released) return; released = true; item.consumers--; if (!item.consumers && (!item.result || item.removed || !contextCurrent(item.context) || item.expires <= this.now())) this.remove(item); };
    try {
      const result = await waitFor(item.pending, signal);
      if (signal?.aborted) throw signal.reason || abortError();
      if (item.removed || !contextCurrent(context)) throw fail("Input, reference or retained incident changed while preparing the clip.", 409);
      if (!existsSync(result.file)) { this.remove(item); throw fail("The prepared clip has expired. Try preparing it again.", 410); }
      return { file: result.file, start_s: context.start_s, end_s: context.end_s, old_reference: context.event.reference_key !== context.reference, release };
    } catch (error) { release(); throw error; }
  }
  get size() { return this.entries.size; }
  async close() { this.closed = true; clearInterval(this.sweepTimer); for (const entry of this.entries.values()) this.remove(entry); await Promise.allSettled([...this.cleanupTasks]); }
}

export function registerGuardianClipRoutes(app: FastifyInstance, options: { getGuidanceSession: (request: FastifyRequest) => Session; sendVideo: (request: FastifyRequest, reply: FastifyReply, file: string) => unknown; cache?: GuardianClipCache }) {
  const cache = options.cache || new GuardianClipCache();
  app.addHook("onClose", async () => cache.close());
  app.get("/api/review/incidents/:id/clip", async (request, reply) => {
    const query = z.object({ source_id: z.string().min(1).max(100), reference_key: z.string().length(64) }).parse(request.query);
    const params = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
    const controller = new AbortController(), abort = () => controller.abort(abortError());
    const timer = setTimeout(() => controller.abort(fail("Clip preparation timed out. Try again.", 504)), GUARDIAN_CLIP_LIMITS.timeout_ms); timer.unref();
    request.raw.once("aborted", abort); reply.raw.once("close", abort);
    let lease: GuardianClipLease | undefined;
    try {
      lease = await cache.acquire(options.getGuidanceSession(request), params.id, query, controller.signal);
      reply.header("Cache-Control", "private, no-store").header("X-Guardian-Clip-Start", String(lease.start_s)).header("X-Guardian-Clip-End", String(lease.end_s)).header("X-Guardian-Old-Reference", String(lease.old_reference));
      const release = lease.release; reply.raw.once("close", release); reply.raw.once("finish", release);
      return options.sendVideo(request, reply, lease.file);
    } catch (error) { lease?.release(); throw error; }
    finally { clearTimeout(timer); request.raw.off("aborted", abort); reply.raw.off("close", abort); }
  });
  return cache;
}
