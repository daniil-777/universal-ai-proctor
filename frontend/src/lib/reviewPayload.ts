import { z } from "zod";
import type { ReviewResponse } from "./reviewTypes";

const text = z.string();
const count = z.number().int().nonnegative();
const timestamp = z.number().finite().nonnegative();
const status = z.enum(["open", "acknowledged", "resolved"]);
const provenance = z.enum(["ai", "operator", "system"]);
const reviewSchema = z.object({
  ok: z.literal(true),
  source_id: text.min(1),
  source_duration_s: z.number().finite().positive().nullable().optional(),
  reference_key: text,
  review_version: count,
  job: z.object({ work_order: text, asset: text, operator: text }),
  checks: z.array(z.object({
    id: text, label: text, kind: z.enum(["tool", "principle"]),
    checked: z.boolean(), checked_at: timestamp.optional(), checked_by: text.optional(),
  })),
  events: z.array(z.object({
    id: text, source_id: text, reference_key: text,
    kind: z.enum(["observation", "milestone", "bookmark"]), provenance,
    occurred_at: timestamp, video_time_s: timestamp,
    summary: text, guidance: text, concern: text,
    status: z.enum(["ok", "watch", "alert"]), step_ids: z.array(text),
    old_reference: z.boolean(), thumbnail_b64: text.optional(),
    thumbnail_available: z.boolean().optional(), operator: text.optional(),
    model: text.optional(), simulated: z.boolean().optional(),
    observation_scope: z.enum(["current", "overview"]).optional(),
  })),
  exceptions: z.array(z.object({
    id: text, title: text, description: text, event_id: text.optional(),
    reference_key: text, provenance, status, old_reference: z.boolean(),
    created_at: timestamp, updated_at: timestamp, history_omitted: count.optional(),
    history: z.array(z.object({ status, note: text, at: timestamp, operator: text })),
  })),
  retention: z.object({
    events: count, thumbnails: count, retained_events: count, retained_thumbnails: count,
    dropped_events: count, dropped_thumbnails: count, dropped_exceptions: count,
  }),
  notice: text,
});

/** Validate before React state updates so a malformed success response cannot crash the workspace. */
export function parseReviewPayload(value: unknown): ReviewResponse {
  const result = reviewSchema.safeParse(value);
  if (!result.success) throw new Error("The server returned incomplete review records. Refresh the review or check the backend connection.");
  return result.data as ReviewResponse;
}
