import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import Fastify from "fastify";
import sharp from "sharp";
import { SessionStore } from "../src/domain/session.js";
import { syncReview, type ReviewEvent } from "../src/domain/review.js";
import { extractFrameAt, probeVideo } from "../src/pipeline/frames.js";
import { GuardianClipCache, extractGuardianClip, guardianClipWindow, guardianIncidentEligible, registerGuardianClipRoutes } from "../src/media/guardianClips.js";

let directory: string;
const caches: GuardianClipCache[] = [];
beforeAll(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "guardian-clip-tests-")); });
afterEach(async () => { await Promise.all(caches.splice(0).map(cache => cache.close())); });
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
function fixture() {
  const session = new SessionStore().get(crypto.randomUUID());
  session.sourceId = "video-one"; session.sourceKind = "video"; session.videoPath = path.join(directory, "source.mp4"); session.videoInfo = { duration: 20, fps: 30, width: 640, height: 360 };
  const review = syncReview(session);
  const event: ReviewEvent = { id: crypto.randomUUID(), source_id: session.sourceId, reference_key: review.reference_key, kind: "observation", provenance: "ai", occurred_at: Date.now(), video_time_s: 8, summary: "Verify the measurement", guidance: "Review the instrument record", concern: "Measurement not visible", status: "watch", step_ids: [] };
  review.events.push(event);
  return { session, event, guard: { source_id: session.sourceId, reference_key: review.reference_key } };
}
function cacheFixture(options: { ttl_ms?: number; max?: number; now?: () => number; delay?: number } = {}) {
  const cleanup = vi.fn(), extract = vi.fn(async (_input, signal: AbortSignal) => {
    if (options.delay) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, options.delay); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
    const file = path.join(directory, crypto.randomUUID() + ".mp4"); await fs.writeFile(file, Buffer.from("mock-mp4-data"));
    return { file, cleanup: async () => { cleanup(file); await fs.rm(file, { force: true }); } };
  });
  const cache = new GuardianClipCache({ extract, ttl_ms: options.ttl_ms, max: options.max, now: options.now }); caches.push(cache);
  return { cache, extract, cleanup };
}

describe("Guardian incident clips", () => {
  it("admits actual AI and system concerns and excludes demo, overview, operator and ok records", () => {
    const { event } = fixture(); expect(guardianIncidentEligible(event)).toBe(true);
    expect(guardianIncidentEligible({ ...event, provenance: "system", status: "alert" })).toBe(true);
    for (const patch of [{ simulated: true }, { observation_scope: "overview" as const }, { provenance: "operator" as const }, { status: "ok" as const }, { kind: "bookmark" as const }]) expect(guardianIncidentEligible({ ...event, ...patch })).toBe(false);
  });
  it("clamps the incident window at the first and last frame and rejects invalid times", () => {
    expect(guardianClipWindow(0, 20)).toEqual({ start_s: 0, end_s: 3 });
    expect(guardianClipWindow(20, 20)).toEqual({ start_s: 14, end_s: 20 });
    expect(guardianClipWindow(8.25, 20)).toEqual({ start_s: 2.25, end_s: 11.25 });
    for (const [time, duration] of [[-1, 20], [21, 20], [NaN, 20], [0, 0]]) expect(() => guardianClipWindow(time, duration)).toThrow("outside this video");
  });
  it("guards source/reference and requires a retained incident from a server-backed video", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture();
    await expect(cache.acquire(session, event.id, { ...guard, source_id: "stale" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(cache.acquire(session, event.id, { ...guard, reference_key: "stale" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(cache.acquire(session, "missing", guard)).rejects.toMatchObject({ statusCode: 404 });
    session.sourceKind = "camera";
    await expect(cache.acquire(session, event.id, guard)).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("do not contain recorded footage") });
    expect(extract).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent extraction, reuses prepared media and labels retained earlier-reference incidents", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture({ delay: 100 });
    event.reference_key = "earlier-reference";
    const leases = await Promise.all([cache.acquire(session, event.id, guard), cache.acquire(session, event.id, guard)]);
    expect(extract).toHaveBeenCalledTimes(1); expect(leases[0].file).toBe(leases[1].file); expect(leases[0]).toMatchObject({ start_s: 2, end_s: 11, old_reference: true });
    leases.forEach(lease => lease.release());
    const again = await cache.acquire(session, event.id, guard); expect(extract).toHaveBeenCalledTimes(1); again.release();
  });
  it("suppresses stale results, aborts obsolete encoding and cleans its cache entry", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture({ delay: 100 });
    const pending = cache.acquire(session, event.id, guard); const failed = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1)); session.mediaGeneration++; cache.sweep();
    await failed; expect(cache.size).toBe(0);
  });
  it("lets one cancelled consumer leave a shared encode running for another consumer", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture({ delay: 30 }), controller = new AbortController();
    const one = cache.acquire(session, event.id, guard, controller.signal), two = cache.acquire(session, event.id, guard);
    const cancelled = expect(one).rejects.toThrow(); controller.abort(new Error("Client closed")); await cancelled;
    const lease = await two; expect(extract).toHaveBeenCalledTimes(1); expect(lease.file).toBeTruthy(); lease.release();
  });
  it("aborts shared extraction when its last consumer disconnects", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture({ delay: 100 }), controller = new AbortController();
    const pending = cache.acquire(session, event.id, guard, controller.signal), failed = expect(pending).rejects.toThrow("Client closed");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1)); controller.abort(new Error("Client closed")); await failed;
    expect(extract.mock.calls[0][1].aborted).toBe(true); expect(cache.size).toBe(0);
  });
  it("expires unpinned files, evicts least-recently-used entries and protects active previews", async () => {
    let now = 100; const { session, event, guard } = fixture(), { cache, cleanup } = cacheFixture({ max: 1, ttl_ms: 10, now: () => now });
    const first = await cache.acquire(session, event.id, guard); const second = { ...event, id: "second" }; session.review!.events.push(second);
    await expect(cache.acquire(session, second.id, guard)).rejects.toMatchObject({ statusCode: 429 }); first.release();
    const lease = await cache.acquire(session, second.id, guard); lease.release(); await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    now = 111; cache.sweep(); await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2)); expect(cache.size).toBe(0);
  });
  it("rejects demo/overview requests and a retained event removed during preparation", async () => {
    const { session, event, guard } = fixture(), { cache, extract } = cacheFixture({ delay: 100 });
    event.simulated = true; await expect(cache.acquire(session, event.id, guard)).rejects.toMatchObject({ statusCode: 400 });
    event.simulated = false; event.observation_scope = "overview"; await expect(cache.acquire(session, event.id, guard)).rejects.toMatchObject({ statusCode: 400 });
    event.observation_scope = "current"; const pending = cache.acquire(session, event.id, guard); const failed = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1)); session.review!.events = []; cache.sweep(); await failed;
  });
  it("serves event-bound metadata through the route and closes cached files with the app", async () => {
    const { session, event, guard } = fixture(), { cache, cleanup } = cacheFixture(), app = Fastify();
    registerGuardianClipRoutes(app, { cache, getGuidanceSession: () => session, sendVideo: (_req, reply, file) => reply.type("video/mp4").header("Accept-Ranges", "bytes").send(readFileSync(file)) });
    const query = new URLSearchParams(guard).toString();
    const response = await app.inject({ url: `/api/review/incidents/${event.id}/clip?${query}` });
    expect(response.statusCode).toBe(200); expect(response.headers["x-guardian-clip-start"]).toBe("2"); expect(response.headers["x-guardian-clip-end"]).toBe("11"); expect(response.headers["cache-control"]).toBe("private, no-store"); expect(response.headers["content-type"]).toContain("video/mp4");
    await app.close(); expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("bounds retained clips across multiple app instances without evicting active streams", async () => {
    const leases = [];
    for (let appIndex = 0; appIndex < 4; appIndex++) {
      const { session, event, guard } = fixture(), { cache } = cacheFixture();
      for (let eventIndex = 0; eventIndex < 8; eventIndex++) { const item = { ...event, id: `incident-${eventIndex}` }; session.review!.events.push(item); leases.push(await cache.acquire(session, item.id, guard)); }
    }
    const { session, event, guard } = fixture(), { cache } = cacheFixture();
    await expect(cache.acquire(session, event.id, guard)).rejects.toMatchObject({ statusCode: 429 });
    leases[0].release(); const next = await cache.acquire(session, event.id, guard); next.release(); leases.forEach(lease => lease.release());
  });
  it("re-encodes a playable, exact nine-second interval without preceding-keyframe drift", async () => {
    const video = path.resolve("../evaluation/assets/parts-sorting.mp4"), signal = new AbortController().signal;
    const started = performance.now(), output = await extractGuardianClip({ path: video, start_s: 6.25, end_s: 15.25 }, signal);
    try {
      const info = await probeVideo(output.file); expect(info.duration).toBeCloseTo(9, 1); expect(info.fps).toBe(30); expect(info.width).toBeLessThanOrEqual(1280); expect(info.height).toBeLessThanOrEqual(720);
      const sourceInfo = await probeVideo(video);
      const original = await extractFrameAt(video, Math.ceil(6.25 * sourceInfo.fps)), encoded = await extractFrameAt(output.file, 0);
      expect(original).not.toBeNull(); expect(encoded).not.toBeNull();
      const a = await sharp(original).resize(64, 36).removeAlpha().raw().toBuffer(), b = await sharp(encoded).resize(64, 36).removeAlpha().raw().toBuffer();
      const difference = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
      expect(difference).toBeLessThan(10); expect(performance.now() - started).toBeLessThan(12000);
    } finally { await output.cleanup(); }
  }, 15000);
});
