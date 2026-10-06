export type ReviewStatus = "open" | "acknowledged" | "resolved";
export interface ReviewEvent {
  id: string;
  source_id: string;
  reference_key: string;
  kind: "observation" | "milestone" | "bookmark";
  provenance: "ai" | "operator" | "system";
  occurred_at: number;
  video_time_s: number;
  summary: string;
  guidance: string;
  concern: string;
  status: "ok" | "watch" | "alert";
  step_ids: string[];
  thumbnail_b64?: string;
  operator?: string;
  model?: string;
  simulated?: boolean;
  observation_scope?: "current" | "overview";
  old_reference: boolean;
  thumbnail_available?: boolean;
}
export interface ReviewException {
  history_omitted?: number;
  id: string;
  title: string;
  description: string;
  event_id?: string;
  reference_key: string;
  provenance: "ai" | "operator" | "system";
  status: ReviewStatus;
  created_at: number;
  updated_at: number;
  history: Array<{
    status: ReviewStatus;
    note: string;
    at: number;
    operator: string;
  }>;
  old_reference: boolean;
}
export interface ReviewResponse {
  ok: true;
  source_id: string;
  /** Optional for older backends; null means no finite uploaded-video duration. */
  source_duration_s?: number | null;
  reference_key: string;
  review_version: number;
  job: { work_order: string; asset: string; operator: string };
  checks: Array<{
    id: string;
    label: string;
    kind: "tool" | "principle";
    checked: boolean;
    checked_at?: number;
    checked_by?: string;
  }>;
  events: ReviewEvent[];
  exceptions: ReviewException[];
  retention: {
    events: number;
    thumbnails: number;
    retained_events: number;
    retained_thumbnails: number;
    dropped_events: number;
    dropped_thumbnails: number;
    dropped_exceptions: number;
  };
  notice: string;
}
export interface ReadinessUpdate {
  job?: Partial<ReviewResponse["job"]>;
  checks?: Array<{ id: string; checked: boolean }>;
}
