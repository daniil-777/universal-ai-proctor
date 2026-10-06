import { z } from "zod";

const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(100);
const time = z.number().finite().nonnegative();
const refs = z.array(id).max(100);
export const DomainKeySchema = z.enum(["surgery", "construction", "manufacturing", "dance", "sports", "meeting", "cooking", "general"]);
export const VideoSummaryModeSchema = z.enum(["balanced", "detailed"]);
export const VideoSummaryStatusSchema = z.enum(["queued", "planning", "analyzing", "synthesizing", "complete", "partial", "cancelled", "failed", "stale"]);
export const VideoSummaryDomainSchema = z.object({
  key: DomainKeySchema, label: z.string().min(1).max(150), basis: z.enum(["video", "document", "both", "operator", "unclear"]),
  rationale: z.string().min(1).max(1500), confidence: z.number().finite().min(0).max(1), conflict: text(1500).nullable(),
}).strict();
export const VideoSummaryFrameSchema = z.object({ id, time_s: time }).strict();
export const VideoSummaryTranscriptSchema = z.object({ id, start_s: time, end_s: time, text: text(8000) }).strict().refine(v => v.end_s >= v.start_s, "Invalid transcript interval");
export const VideoSummaryFindingFields = {
  kind: z.enum(["action", "state", "transition", "decision", "action_item"]), label: z.string().min(1).max(300), detail: text(2000),
  start_s: time, end_s: time, frame_refs: refs, transcript_refs: refs,
  metric_ids: z.array(id).max(12),
  certainty: z.enum(["observed", "estimated"]), uncertainty: text(1500).nullable(),
} as const;
export const VideoSummaryFindingSchema = z.object({ id, ...VideoSummaryFindingFields }).strict().refine(v => v.end_s >= v.start_s, "Invalid finding interval");
export const VideoSummaryMetricPlanSchema = z.object({ id, label: text(200), question: text(500), kind: z.enum(["count", "timing", "observable_state", "document_criterion"]), unit: text(80), method: text(1500), limitations: text(1500) }).strict();
export const VideoSummaryMetricSchema = z.object({ id, label: text(200), value: z.number().finite().nullable(), unit: text(80), status: z.enum(["measured", "estimated", "unavailable"]), method: text(1500), evidence_refs: z.array(id).max(12000), explanation: text(2000) }).strict();
export const VideoSummaryWindowSchema = z.object({
  id, start_s: time, end_s: time, status: z.enum(["complete", "failed"]), sampled_frames: z.array(VideoSummaryFrameSchema).max(9),
  transcript: z.array(VideoSummaryTranscriptSchema).max(100), summary: text(2000), narration: text(1500), phase: text(200),
  events: z.array(VideoSummaryFindingSchema).max(20), uncertainties: z.array(text(1500)).max(20), error: text(2000).nullable(),
}).strict();
export const VideoSummaryChapterSchema = z.object({ id, title: z.string().min(1).max(300), start_s: time, end_s: time, summary: z.string().min(1).max(2000), evidence_refs: refs }).strict().refine(v => v.end_s >= v.start_s, "Invalid chapter interval");
export const VideoSummarySynthesisSchema = z.object({
  headline: z.string().min(1).max(300), overview: z.string().min(1).max(4000), chapters: z.array(VideoSummaryChapterSchema).max(40),
  key_findings: z.array(z.object({ text: z.string().min(1).max(2000), evidence_refs: refs }).strict()).max(30), limitations: z.array(text(2000)).max(40),
}).strict();
export const VideoSummaryJobSchema = z.object({
  schema_version: z.literal(1), id, status: VideoSummaryStatusSchema, created_at: text(100), updated_at: text(100),
  source: z.object({ id, name: text(1000), duration_s: z.number().finite().positive(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  reference: z.object({ key: id, name: text(1000) }).strict(), mode: VideoSummaryModeSchema,
  model: z.object({ provider: text(100), model_id: text(200) }).strict(), domain: VideoSummaryDomainSchema.nullable(),
  metric_plan: z.array(VideoSummaryMetricPlanSchema).max(12), metrics: z.array(VideoSummaryMetricSchema).max(12),
  progress: z.object({ total_windows: z.number().int().max(600).nonnegative(), completed_windows: z.number().int().nonnegative(), failed_windows: z.number().int().nonnegative(), analyzed_through_s: time, sampled_frames: z.number().int().nonnegative() }).strict(),
  windows: z.array(VideoSummaryWindowSchema).max(600), summary: VideoSummarySynthesisSchema.nullable(), error: text(2000).nullable(),
  audio: z.object({ requested: z.boolean(), status: z.enum(["pending", "available", "unavailable", "no_audio", "disabled"]), note: text(2000).nullable() }).strict(),
  provenance: z.object({ visual_analysis: z.literal("sampled_frames"), simulated: z.boolean(), instruction_snapshot: id, model_calls: z.number().int().nonnegative() }).strict(),
}).strict();
export const VideoSummaryStartSchema = z.object({
  source_id: id, reference_key: id, mode: VideoSummaryModeSchema,
  provider: z.string().min(1).max(100).optional(), model_id: z.string().min(1).max(200).optional(), reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  domain_override: DomainKeySchema.optional(), include_audio: z.boolean().optional(),
}).strict();
export const VIDEO_SUMMARY_LIMITS = Object.freeze({ windows: 600, active: 1, queued: 2, retained_jobs: 100, terminal_bytes: 64 * 1024 * 1024, terminal_ttl_ms: 60 * 60 * 1000 });
export const VIDEO_SUMMARY_MODES = Object.freeze({ detailed: { window_s: 6, frames: 9 }, balanced: { window_s: 12, frames: 6 } });
export type DomainKey = z.infer<typeof DomainKeySchema>;
export type VideoSummaryMode = z.infer<typeof VideoSummaryModeSchema>;
export type VideoSummaryStatus = z.infer<typeof VideoSummaryStatusSchema>;
export type VideoSummaryDomain = z.infer<typeof VideoSummaryDomainSchema>;
export type VideoSummaryFrame = z.infer<typeof VideoSummaryFrameSchema>;
export type VideoSummaryTranscript = z.infer<typeof VideoSummaryTranscriptSchema>;
export type VideoSummaryFinding = z.infer<typeof VideoSummaryFindingSchema>;
export type VideoSummaryMetricPlan = z.infer<typeof VideoSummaryMetricPlanSchema>;
export type VideoSummaryMetric = z.infer<typeof VideoSummaryMetricSchema>;
export type VideoSummaryWindow = z.infer<typeof VideoSummaryWindowSchema>;
export type VideoSummarySynthesis = z.infer<typeof VideoSummarySynthesisSchema>;
export type VideoSummaryJob = z.infer<typeof VideoSummaryJobSchema>;
export type VideoSummaryStartInput = z.infer<typeof VideoSummaryStartSchema>;
export interface VideoSummaryPlan { source_id: string; reference_key: string; source_name: string; duration_s: number; mode: VideoSummaryMode; window_s: number; total_windows: number; frames_per_window: number; estimated_model_calls: number; audio_available: boolean; max_duration_s: number }
export interface AudioReadInput { path: string; start_s: number; end_s: number; signal: AbortSignal }
export interface AudioReadResult { status: "available" | "no_audio" | "unavailable"; segments: VideoSummaryTranscript[]; note: string | null }
export type ReadAudio = (input: AudioReadInput) => Promise<AudioReadResult>;
