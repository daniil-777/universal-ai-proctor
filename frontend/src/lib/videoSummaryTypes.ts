import { z } from "zod";

export const DOMAIN_OPTIONS = ["surgery", "construction", "manufacturing", "dance", "sports", "meeting", "cooking", "general"] as const;
export const domainLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const time = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const refs = z.array(z.string());
const range = { start_s: time, end_s: time };
const frame = z.object({ id: z.string(), time_s: time });
const transcript = z.object({ id: z.string(), ...range, text: z.string() });
const finding = z.object({ id: z.string(), kind: z.enum(["action", "state", "transition", "decision", "action_item"]), label: z.string(), detail: z.string(), ...range, frame_refs: refs, transcript_refs: refs, metric_ids: refs, certainty: z.enum(["observed", "estimated"]), uncertainty: z.string().nullable() });
export const videoSummaryJobSchema = z.object({
  schema_version: z.literal(1), id: z.string(), status: z.enum(["queued", "planning", "analyzing", "synthesizing", "complete", "partial", "cancelled", "failed", "stale"]), created_at: z.string(), updated_at: z.string(),
  source: z.object({ id: z.string(), name: z.string(), duration_s: time, width: count, height: count }),
  reference: z.object({ key: z.string(), name: z.string() }), mode: z.enum(["balanced", "detailed"]), model: z.object({ provider: z.string(), model_id: z.string() }),
  domain: z.object({ key: z.enum(DOMAIN_OPTIONS), label: z.string(), basis: z.enum(["video", "document", "both", "operator", "unclear"]), rationale: z.string(), confidence: z.number().finite().min(0).max(1), conflict: z.string().nullable() }).nullable(),
  metric_plan: z.array(z.object({ id: z.string(), label: z.string(), question: z.string(), kind: z.enum(["count", "timing", "observable_state", "document_criterion"]), unit: z.string(), method: z.string(), limitations: z.string() })),
  metrics: z.array(z.object({ id: z.string(), label: z.string(), value: z.number().finite().nullable(), unit: z.string(), status: z.enum(["measured", "estimated", "unavailable"]), method: z.string(), evidence_refs: refs, explanation: z.string() })),
  progress: z.object({ total_windows: count.max(600), completed_windows: count, failed_windows: count, analyzed_through_s: time, sampled_frames: count }),
  windows: z.array(z.object({ id: z.string(), ...range, status: z.enum(["complete", "failed"]), sampled_frames: z.array(frame), transcript: z.array(transcript), summary: z.string(), narration: z.string(), phase: z.string(), events: z.array(finding), uncertainties: z.array(z.string()), error: z.string().nullable() })).max(600),
  summary: z.object({ headline: z.string(), overview: z.string(), chapters: z.array(z.object({ id: z.string(), title: z.string(), ...range, summary: z.string(), evidence_refs: refs })), key_findings: z.array(z.object({ text: z.string(), evidence_refs: refs })), limitations: z.array(z.string()) }).nullable(),
  error: z.string().nullable(), audio: z.object({ requested: z.boolean(), status: z.enum(["pending", "available", "unavailable", "no_audio", "disabled"]), note: z.string().nullable() }),
  provenance: z.object({ visual_analysis: z.literal("sampled_frames"), simulated: z.boolean(), instruction_snapshot: z.string(), model_calls: count }),
});
export type VideoSummaryJob = z.infer<typeof videoSummaryJobSchema>;
export type VideoSummaryWindow = VideoSummaryJob["windows"][number];
export type DomainKey = typeof DOMAIN_OPTIONS[number];
export type RecapMode = VideoSummaryJob["mode"];
export const videoSummaryPlanSchema = z.object({ source_id: z.string(), reference_key: z.string(), source_name: z.string(), duration_s: time, mode: z.enum(["detailed", "balanced"]), window_s: time, total_windows: count.max(600), frames_per_window: count, estimated_model_calls: count, audio_available: z.boolean(), max_duration_s: time });
export type VideoSummaryPlan = z.infer<typeof videoSummaryPlanSchema>;
export const recapIsActive = (job: VideoSummaryJob | null) => !!job && ["queued", "planning", "analyzing", "synthesizing"].includes(job.status);
export const recapHasResult = (job: VideoSummaryJob | null) => !!job && ["complete", "partial"].includes(job.status);

export function parseVideoSummaryJob(value: unknown): VideoSummaryJob {
  const result = videoSummaryJobSchema.safeParse(value);
  if (!result.success) throw new Error("The backend returned an incomplete video recap. Retry or check the connection.");
  const job = result.data;
  const inRange = (start: number, end: number) => start <= end && end <= job.source.duration_s;
  const identities = new Set<string>();
  const add = (id: string) => { if (identities.has(id)) throw new Error("The recap contains duplicate evidence identities."); identities.add(id); };
  for (const window of job.windows) {
    if (!inRange(window.start_s, window.end_s)) throw new Error("The recap contains an invalid video interval.");
    add(window.id);
    for (const frame of window.sampled_frames) { if (frame.time_s > job.source.duration_s) throw new Error("The recap contains an invalid frame timestamp."); add(frame.id); }
    for (const line of window.transcript) { if (!inRange(line.start_s, line.end_s)) throw new Error("The recap contains an invalid audio interval."); add(line.id); }
    for (const event of window.events) { if (!inRange(event.start_s, event.end_s)) throw new Error("The recap contains an invalid event interval."); add(event.id); }
  }
  const findingIds = new Set(job.windows.flatMap(window => window.events.map(event => event.id)));
  const metricIds = new Set(job.metric_plan.map(metric => metric.id));
  const validRefs = (items: string[]) => items.every(id => findingIds.has(id));
  for (const window of job.windows) for (const event of window.events) {
    if (!event.metric_ids.every(id => metricIds.has(id))) throw new Error("The recap contains a foreign metric reference.");
    if (!event.frame_refs.every(id => window.sampled_frames.some(frame => frame.id === id)) || !event.transcript_refs.every(id => window.transcript.some(line => line.id === id)) || (!event.frame_refs.length && !event.transcript_refs.length)) throw new Error("The recap cites evidence that is not present in this result.");
  }
  for (const metric of job.metrics) {
    if (!validRefs(metric.evidence_refs) || (metric.status === "unavailable" ? metric.value !== null : metric.value === null)) throw new Error("The recap contains an unsupported metric.");
  }
  for (const chapter of job.summary?.chapters ?? []) if (!inRange(chapter.start_s, chapter.end_s) || !validRefs(chapter.evidence_refs)) throw new Error("The recap contains an unsupported chapter.");
  for (const finding of job.summary?.key_findings ?? []) if (!validRefs(finding.evidence_refs)) throw new Error("The recap contains an unsupported finding.");
  if (job.progress.completed_windows + job.progress.failed_windows > job.progress.total_windows || job.progress.analyzed_through_s > job.source.duration_s) throw new Error("The recap contains invalid processing progress.");
  return job;
}

export function recapTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

/** Describe one actual retained citation without manufacturing an image preview. */
export function recapEvidence(job: VideoSummaryJob, id: string): { title: string; text: string; time: number; supportingRefs?: string[] } | null {
  for (const window of job.windows) {
    if (window.id === id) return { title: `Window ${recapTime(window.start_s)}–${recapTime(window.end_s)}`, text: window.summary, time: window.start_s };
    const frame = window.sampled_frames.find(item => item.id === id);
    if (frame) return { title: `Sampled frame · ${recapTime(frame.time_s)}`, text: `Source frame at ${frame.time_s.toFixed(3)} seconds. Retained frame identity: ${frame.id}.`, time: frame.time_s };
    const line = window.transcript.find(item => item.id === id);
    if (line) return { title: `Transcribed audio · ${recapTime(line.start_s)}–${recapTime(line.end_s)}`, text: line.text, time: line.start_s };
    const event = window.events.find(item => item.id === id);
    if (event) return { title: event.label, text: `${event.detail}${event.uncertainty ? ` ${event.uncertainty}` : ""}`, time: event.start_s, supportingRefs: [...event.frame_refs, ...event.transcript_refs] };
  }
  return null;
}
