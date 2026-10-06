import type { VideoSummaryJob } from "./videoSummaryTypes";
/** Synthetic records for contract tests, explicitly labeled as simulated. */
export function recapFixture(overrides: Partial<VideoSummaryJob> = {}): VideoSummaryJob {
  return {
    schema_version: 1, id: "job-A", status: "complete", created_at: "2026-10-06T10:00:00.000Z", updated_at: "2026-10-06T10:00:01.000Z",
    source: { id: "source-A", name: "Synthetic test video.mp4", duration_s: 6, width: 320, height: 180 }, reference: { key: "reference-A", name: "Synthetic guide.txt" }, mode: "detailed", model: { provider: "openai", model_id: "test-model" },
    domain: { key: "manufacturing", label: "Manufacturing", basis: "both", rationale: "Synthetic visual and document context.", confidence: .7, conflict: null },
    metric_plan: [], metrics: [{ id: "actions", label: "Observed episodes", value: 1, unit: "episodes", status: "estimated", method: "Retained distinct events; a lower bound.", evidence_refs: ["W0001-E01"], explanation: "Synthetic test evidence only." }],
    progress: { total_windows: 1, completed_windows: 1, failed_windows: 0, analyzed_through_s: 6, sampled_frames: 1 },
    windows: [{ id: "W0001", start_s: 0, end_s: 6, status: "complete", sampled_frames: [{ id: "W0001-F01", time_s: 2 }], transcript: [], summary: "Synthetic action shown.", narration: "This is a simulated accepted window.", phase: "Synthetic process", events: [{ id: "W0001-E01", kind: "action", label: "Synthetic action", detail: "Test event supported by its sampled frame.", start_s: 2, end_s: 3, frame_refs: ["W0001-F01"], transcript_refs: [], metric_ids: [], certainty: "observed", uncertainty: null }], uncertainties: ["Synthetic fixture, not production analysis."], error: null }],
    summary: { headline: "A synthetic test recap", overview: "A fixture for evidence and ownership tests.", chapters: [{ id: "chapter-1", title: "Synthetic chapter", start_s: 0, end_s: 6, summary: "Accepted test event.", evidence_refs: ["W0001-E01"] }], key_findings: [{ text: "The test event is retained.", evidence_refs: ["W0001-E01"] }], limitations: ["Synthetic test data."] }, error: null,
    audio: { requested: false, status: "disabled", note: null }, provenance: { visual_analysis: "sampled_frames", simulated: true, instruction_snapshot: "fixture-definition", model_calls: 0 }, ...overrides,
  };
}
