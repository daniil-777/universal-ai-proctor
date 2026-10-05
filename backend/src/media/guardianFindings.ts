import type { ReviewEvent, StructuredHandoff } from "../domain/review.js";
const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
export const GUARDIAN_WINDOW = Object.freeze({ before_s: 6, after_s: 3 });
export function guardianIncidentEligible(event: ReviewEvent) {
  return !event.simulated && event.observation_scope !== "overview" && event.kind !== "bookmark"
    && (event.provenance === "ai" || event.provenance === "system") && (event.status === "watch" || event.status === "alert");
}
export function guardianClipWindow(time: number, duration: number) {
  if (!Number.isFinite(time) || time < 0 || !Number.isFinite(duration) || duration <= 0 || time > duration)
    throw fail("The incident timestamp is outside this video.", 400);
  const start_s = Math.max(0, time - GUARDIAN_WINDOW.before_s), end_s = Math.min(duration, time + GUARDIAN_WINDOW.after_s);
  if (end_s <= start_s) throw fail("No playable video window is available for this incident.", 400);
  return { start_s, end_s };
}
/** Static export index; no mutable URLs, generated assessments or embedded video. */
export function guardianReportFindings(data: StructuredHandoff) {
  return data.evidence.filter(event => event.source_id === data.source.id && guardianIncidentEligible(event)).map(event => {
    let window: ReturnType<typeof guardianClipWindow> | null = null;
    if (data.source.kind === "video" && data.source.duration_s !== null) {
      try { window = guardianClipWindow(event.video_time_s, data.source.duration_s); } catch { /* Keep the finding even when playable footage is unavailable. */ }
    }
    return { event, window, decisions: data.exception_history.filter(issue => issue.event_id === event.id) };
  });
}
