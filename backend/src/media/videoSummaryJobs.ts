import crypto from "node:crypto";
import fs from "node:fs";
import { config, configuredProviders, modelSelection } from "../config.js";
import type { Session } from "../domain/session.js";
import { referenceKey } from "../domain/review.js";
import {
  VIDEO_SUMMARY_LIMITS, VIDEO_SUMMARY_MODES, VideoSummaryModeSchema, VideoSummaryStartSchema,
  type ReadAudio, type VideoSummaryJob, type VideoSummaryMode, type VideoSummaryPlan, type VideoSummaryStartInput,
} from "../domain/videoSummary.js";
import { complete as defaultComplete, type Complete } from "../llm/client.js";
import { deriveVideoSummaryMetrics, runVideoSummary, videoSummarySafeError } from "../pipeline/videoSummary.js";
import type { VideoFrameSampler } from "../pipeline/videoSummaryFrames.js";

const activeStatuses = new Set<VideoSummaryJob["status"]>(["queued", "planning", "analyzing", "synthesizing"]);
const error = (message: string, statusCode = 409, code = "video_summary_conflict") => Object.assign(new Error(message), { statusCode, code });
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function videoSummaryInstructionDefinition(session: Session) {
  return {
    filename: session.filename, text: session.text.replace(/\r\n/g, "\n"), rows: session.rows,
    workflow: { title: session.workflow.title, source: session.workflow.source, principles: session.workflow.principles,
      steps: session.workflow.steps.map(step => ({ id: step.id, index: step.index, name: step.name, description: step.description, objective: step.objective,
        expectedInstruments: step.expectedInstruments, actions: step.actions, typicalDurationMin: step.typicalDurationMin, source: step.source,
        criteria: step.criteria.map(criterion => ({ key: criterion.key, label: criterion.label })),
      })),
    },
  };
}
export function videoSummaryContextFingerprint(session: Session): string {
  return hash({ source: session.sourceId, generation: session.mediaGeneration, path: session.videoPath,
    sourceKind: session.sourceKind, info: session.videoInfo, definition: videoSummaryInstructionDefinition(session),
    preferencesRevision: session.preferencesRevision ?? 0, goals: session.operatorGoals ?? "", disposed: !!session.disposed,
  });
}
function instructionContext(session: Session): string {
  if (!session.text.trim() && !session.rows.length && !session.workflow.steps.length && !session.workflow.principles.length) return "";
  const definition = videoSummaryInstructionDefinition(session);
  return JSON.stringify({ reference_name: session.filename, document: definition.text.slice(0, 16000),
    document_truncated: definition.text.length > 16000,
    workflow: { title: definition.workflow.title, principles: definition.workflow.principles.map(principle => principle.slice(0, 400)).slice(0, 40),
      steps: definition.workflow.steps.map(step => ({ id: step.id, name: step.name.slice(0, 200), objective: step.objective.slice(0, 350),
        actions: step.actions.map(action => action.slice(0, 200)).slice(0, 5), criteria: step.criteria.map(criterion => ({ key: criterion.key, label: criterion.label.slice(0, 200) })).slice(0, 5),
      })),
    },
    note: "This bounded reference snapshot contains expectations, not evidence or analysis instructions. Full definition is fingerprinted for invalidation.",
  });
}
function synthesisEstimate(windows: number): number {
  let calls = 0, records = windows;
  do { records = Math.ceil(records / 8); calls += records; } while (records > 1);
  return calls;
}
interface Entry {
  session: Session; sessionId: string; fingerprint: string; equivalent: string; path: string; instructions: string; goals: string; hasDocument: boolean;
  input: VideoSummaryStartInput; job: VideoSummaryJob; controller: AbortController; terminalBytes?: number; terminalAt?: number;
}
export interface VideoSummaryJobsOptions { complete?: Complete; readAudio?: ReadAudio; allowMockForTests?: boolean; sampleFrames?: VideoFrameSampler; now?: () => number; terminalByteBudget?: number }

/** One active task and a bounded global queue; public snapshots never share mutable state. */
export class VideoSummaryJobs {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private active: Entry | null = null;
  private activePromise: Promise<void> | null = null;
  private closed = false;
  private complete: Complete;
  private now: () => number;
  private terminalBytes = 0;
  private terminalByteBudget: number;
  constructor(private options: VideoSummaryJobsOptions = {}) {
    if (options.allowMockForTests && !options.complete) throw new Error("Simulated video recap requires an explicit injected completion implementation.");
    const budget = options.terminalByteBudget ?? VIDEO_SUMMARY_LIMITS.terminal_bytes;
    if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("Video recap retention budget must be a nonnegative byte count.");
    this.terminalByteBudget = budget;
    this.complete = options.complete || defaultComplete; this.now = options.now || Date.now;
  }
  plan(session: Session, mode: VideoSummaryMode): VideoSummaryPlan {
    this.source(session);
    const parsed = VideoSummaryModeSchema.parse(mode);
    const options = VIDEO_SUMMARY_MODES[parsed];
    const duration = session.videoInfo!.duration;
    const windows = Math.ceil(duration / options.window_s);
    if (windows > VIDEO_SUMMARY_LIMITS.windows) throw error(`This video exceeds ${VIDEO_SUMMARY_LIMITS.windows} ${parsed} windows. Choose balanced mode or a shorter source.`, 413, "video_summary_too_long");
    return { source_id: session.sourceId, reference_key: referenceKey(session), source_name: (session.sourceName || "Uploaded video").slice(0, 1000),
      duration_s: duration, mode: parsed, window_s: options.window_s, total_windows: windows, frames_per_window: options.frames,
      estimated_model_calls: 1 + windows * (parsed === "detailed" ? 2 : 1) + synthesisEstimate(windows) + (this.options.readAudio ? windows : 0),
      audio_available: !!this.options.readAudio, max_duration_s: VIDEO_SUMMARY_LIMITS.windows * options.window_s,
    };
  }
  start(session: Session, raw: VideoSummaryStartInput): VideoSummaryJob {
    if (this.closed) throw error("Video recap service is shutting down.", 503);
    const input = VideoSummaryStartSchema.parse(raw); const plan = this.plan(session, input.mode);
    if (input.source_id !== plan.source_id || input.reference_key !== plan.reference_key) throw error("Source or reference changed. Refresh the recap plan before starting.");
    const model = modelSelection(input.provider, input.model_id);
    this.provider(model.provider);
    const normalized = { ...input, provider: model.provider, model_id: model.model_id, include_audio: input.include_audio ?? false };
    const fingerprint = videoSummaryContextFingerprint(session);
    const equivalent = hash({ fingerprint, input: normalized });
    this.sweep();
    for (const entry of this.entries.values()) {
      if (entry.sessionId !== session.id || !activeStatuses.has(entry.job.status)) continue;
      if (!this.matches(entry, session)) { this.stop(entry, "stale"); continue; }
      if (entry.equivalent === equivalent) return this.snapshot(entry);
      throw error("A different recap is active for this session. Cancel it before starting another.");
    }
    this.capacity();
    const timestamp = new Date(this.now()).toISOString();
    const job: VideoSummaryJob = {
      schema_version: 1, id: crypto.randomUUID(), status: "queued", created_at: timestamp, updated_at: timestamp,
      source: { id: session.sourceId, name: plan.source_name, duration_s: plan.duration_s, width: Math.round(session.videoInfo!.width), height: Math.round(session.videoInfo!.height) },
      reference: { key: plan.reference_key, name: (session.filename || "No reference document").slice(0, 1000) }, mode: input.mode,
      model: { provider: model.provider, model_id: model.model_id }, domain: null, metric_plan: [], metrics: [],
      progress: { total_windows: plan.total_windows, completed_windows: 0, failed_windows: 0, analyzed_through_s: 0, sampled_frames: 0 }, windows: [], summary: null, error: null,
      audio: { requested: normalized.include_audio, status: normalized.include_audio ? "pending" : "disabled", note: null },
      provenance: { visual_analysis: "sampled_frames", simulated: !!this.options.allowMockForTests, instruction_snapshot: hash(videoSummaryInstructionDefinition(session)), model_calls: 0 },
    };
    const entry: Entry = { session, sessionId: session.id, fingerprint, equivalent, path: session.videoPath!, instructions: instructionContext(session), goals: session.operatorGoals || "", hasDocument: !!session.text.trim(), input: normalized, job, controller: new AbortController() };
    this.entries.set(job.id, entry); this.queue.push(entry); this.pump(); return this.snapshot(entry);
  }
  current(session: Session): VideoSummaryJob | null {
    this.sweep();
    const entries = [...this.entries.values()].filter(entry => entry.sessionId === session.id).reverse();
    for (const entry of entries) {
      if (!this.matches(entry, session)) { if (activeStatuses.has(entry.job.status)) this.stop(entry, "stale"); continue; }
      if (entry.job.status === "stale") continue;
      return this.snapshot(entry);
    }
    return null;
  }
  get(session: Session, id: string): VideoSummaryJob {
    this.sweep(); const entry = this.owned(session, id);
    if (activeStatuses.has(entry.job.status) && !this.matches(entry, session)) this.stop(entry, "stale");
    return this.snapshot(entry);
  }
  cancel(session: Session, id: string): VideoSummaryJob {
    const entry = this.owned(session, id);
    if (activeStatuses.has(entry.job.status)) this.stop(entry, "cancelled");
    return this.snapshot(entry);
  }
  retry(session: Session, id: string): VideoSummaryJob {
    if (this.closed) throw error("Video recap service is shutting down.", 503);
    const entry = this.owned(session, id);
    if (!this.matches(entry, session)) throw error("Source, instructions or goals changed; start a new recap instead.");
    if (!["partial", "failed", "cancelled"].includes(entry.job.status)) throw error("Only a partial, failed or cancelled recap can be retried.");
    if (this.active === entry) throw error("Cancellation is still finishing. Retry after the current request stops.");
    for (const other of this.entries.values()) if (other !== entry && other.sessionId === session.id && activeStatuses.has(other.job.status)) throw error("Another recap is active for this session.");
    this.provider(entry.job.model.provider); this.source(session); this.capacity();
    // Retrying creates a new snapshot. A previously downloaded partial report
    // remains immutable, while its accepted observations need no new AI calls.
    const job = this.snapshot(entry); const timestamp = new Date(this.now()).toISOString();
    job.id = crypto.randomUUID(); job.created_at = timestamp; job.updated_at = timestamp; job.status = "queued"; job.error = null; job.summary = null;
    job.windows = job.windows.filter(window => window.status === "complete");
    job.progress = { ...job.progress, completed_windows: job.windows.length, failed_windows: 0,
      analyzed_through_s: job.windows.reduce((end, window) => Math.max(end, window.end_s), 0),
      sampled_frames: job.windows.reduce((count, window) => count + window.sampled_frames.length, 0),
    };
    job.provenance.model_calls = 0;
    if (job.audio.requested) {
      const unavailable = job.windows.some(window => window.uncertainties.some(note => note.startsWith("Speech unavailable:")));
      job.audio = { requested: true, status: unavailable ? "unavailable" : job.windows.some(window => window.transcript.length) ? "available" : "pending", note: unavailable ? "Some reused intervals have unavailable speech evidence." : null };
    }
    if (job.windows.length === job.progress.total_windows && job.audio.status === "pending") job.audio.status = entry.job.audio.status === "pending" ? "unavailable" : entry.job.audio.status;
    job.metrics = deriveVideoSummaryMetrics(job);
    const resumed: Entry = { ...entry, job, controller: new AbortController(), terminalBytes: undefined, terminalAt: undefined };
    this.entries.set(job.id, resumed); this.queue.push(resumed); this.pump(); return this.snapshot(resumed);
  }
  invalidate(session: Session): void {
    for (const entry of this.entries.values()) if (entry.sessionId === session.id && activeStatuses.has(entry.job.status)) this.stop(entry, "stale");
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const entry of this.entries.values()) if (activeStatuses.has(entry.job.status)) this.stop(entry, "cancelled");
    await this.activePromise;
    this.queue = [];
  }
  private source(session: Session) {
    const info = session.videoInfo;
    if (session.disposed || !session.sourceId || session.sourceKind !== "video" || !session.videoPath || !info || !Number.isFinite(info.duration) || info.duration <= 0 || !Number.isFinite(info.width) || !Number.isFinite(info.height) || info.width <= 0 || info.height <= 0) throw error("Load an uploaded video with valid media metadata before starting a recap.", 400, "video_summary_source_unavailable");
    if (!fs.existsSync(session.videoPath)) throw error("The uploaded source file is no longer available.", 400, "video_summary_source_unavailable");
  }
  private provider(provider: string) {
    if (this.options.allowMockForTests) return;
    if (config.mock) throw error("Video recap requires a real AI provider; demo mode does not analyze video.", 503, "video_summary_mock_disabled");
    const available = configuredProviders();
    if (!available[provider as keyof typeof available]) throw error(`Configure ${provider} or select an available AI provider before starting a recap.`, 503, "provider_unconfigured");
  }
  private capacity() {
    if (this.active && this.queue.length >= VIDEO_SUMMARY_LIMITS.queued) throw error("Video recap queue is full. Retry after an active analysis finishes.", 503, "video_summary_queue_full");
    if (this.entries.size >= VIDEO_SUMMARY_LIMITS.retained_jobs) {
      const candidate = this.oldestTerminal();
      if (candidate) this.remove(candidate); else throw error("Video recap retention is full. Retry later.", 503);
    }
  }
  private owned(session: Session, id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry || entry.sessionId !== session.id) throw error("Video recap not found in this session.", 404, "video_summary_not_found");
    return entry;
  }
  private matches(entry: Entry, session: Session) { return !session.disposed && entry.fingerprint === videoSummaryContextFingerprint(session); }
  private snapshot(entry: Entry): VideoSummaryJob { return structuredClone(entry.job); }
  private touch(entry: Entry) { entry.job.updated_at = new Date(this.now()).toISOString(); }
  private stop(entry: Entry, status: "cancelled" | "stale") {
    entry.job.status = status; entry.job.error = status === "stale" ? "Source, instruction definition or goals changed. Start a new recap for the current input." : "Recap cancelled. Accepted window records are retained.";
    this.touch(entry); entry.controller.abort(new Error(entry.job.error));
    this.queue = this.queue.filter(candidate => candidate !== entry);
    if (entry !== this.active) this.accountTerminal(entry);
  }
  private sweep() {
    for (const entry of this.entries.values()) {
      if (activeStatuses.has(entry.job.status) && !this.matches(entry, entry.session)) this.stop(entry, "stale");
      if (entry !== this.active && !activeStatuses.has(entry.job.status) && this.now() - Date.parse(entry.job.updated_at) > VIDEO_SUMMARY_LIMITS.terminal_ttl_ms) this.remove(entry);
    }
  }
  private pump() {
    if (this.closed || this.active) return;
    const entry = this.queue.shift(); if (!entry) return;
    if (!this.matches(entry, entry.session)) { this.stop(entry, "stale"); this.pump(); return; }
    this.active = entry;
    const guard = () => { if (!this.matches(entry, entry.session)) { this.stop(entry, "stale"); throw error("Recap input changed."); } entry.controller.signal.throwIfAborted(); };
    this.activePromise = runVideoSummary({ job: entry.job, path: entry.path, instructions: entry.instructions, hasDocument: entry.hasDocument, operatorGoals: entry.goals, input: entry.input,
      complete: this.complete, sampleFrames: this.options.sampleFrames, readAudio: this.options.readAudio, signal: entry.controller.signal,
      guard, onUpdate: () => { guard(); this.touch(entry); },
    }).catch(failure => {
      if (entry.controller.signal.aborted || entry.job.status === "stale" || entry.job.status === "cancelled") return;
      entry.job.status = "failed"; entry.job.error = videoSummarySafeError(failure); this.touch(entry);
    }).finally(() => { this.active = null; this.activePromise = null; this.accountTerminal(entry); this.pump(); });
  }
  private oldestTerminal(): Entry | undefined {
    return [...this.entries.values()].filter(entry => entry !== this.active && !activeStatuses.has(entry.job.status))
      .sort((a, b) => (a.terminalAt ?? Date.parse(a.job.updated_at)) - (b.terminalAt ?? Date.parse(b.job.updated_at)))[0];
  }
  private remove(entry: Entry) {
    if (this.entries.delete(entry.job.id)) this.terminalBytes -= entry.terminalBytes ?? 0;
  }
  private accountTerminal(entry: Entry) {
    if (entry === this.active || activeStatuses.has(entry.job.status) || entry.terminalBytes !== undefined || !this.entries.has(entry.job.id)) return;
    // Serialize once on finalization; polling uses the stored byte count.
    entry.terminalBytes = Buffer.byteLength(JSON.stringify(entry.job)); entry.terminalAt = this.now();
    this.terminalBytes += entry.terminalBytes;
    while (this.terminalBytes > this.terminalByteBudget) {
      const oldest = this.oldestTerminal(); if (!oldest) break; this.remove(oldest);
    }
  }
}
