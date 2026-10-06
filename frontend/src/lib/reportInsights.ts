import type { ChatMessage, Stage } from "./types";
import type { ReviewEvent, ReviewResponse } from "./reviewTypes";

export function formatReportTime(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const reportProvenance = (event: ReviewEvent) =>
  event.simulated ? "Demo / simulated" : event.provenance === "ai"
    ? "AI observation" : event.provenance === "system" ? "System check" : "Operator record";

export const reportEventTime = (event: ReviewEvent) => Number.isFinite(event.video_time_s) && event.video_time_s >= 0
  ? formatReportTime(event.video_time_s) : "Timestamp unavailable";

/** One pass, preserving the first completed answer between successive questions. */
export function completedConversation(messages: readonly ChatMessage[]) {
  const pairs: { q: string; a: string; ts: number }[] = [];
  let question: ChatMessage | undefined;
  for (const message of messages) {
    if (message.role === "user") { question = message; continue; }
    if (!question || message.streaming || !message.text) continue;
    if (!message.text.startsWith("⚠") && !message.text.startsWith("🛡️"))
      pairs.push({ q: question.text, a: message.text, ts: question.ts });
    question = undefined;
  }
  return pairs;
}

/** Real, source-scoped moments only. Overview and demo records have separate meanings. */
export function reportMoments(review: ReviewResponse | null) {
  return (review?.events ?? []).filter(event =>
    event.source_id === review?.source_id && !event.simulated &&
    event.observation_scope !== "overview" &&
    Number.isFinite(event.video_time_s) && event.video_time_s >= 0,
  ).slice().sort((a, b) => a.video_time_s - b.video_time_s || a.occurred_at - b.occurred_at);
}

export function reportCounts(stages: readonly Stage[], review: ReviewResponse | null) {
  const criteria = { met: 0, partial: 0, not_met: 0, unknown: 0 };
  const confirmation = { ai: 0, manual: 0, other: 0, unfinished: 0 };
  for (const step of stages) {
    for (const criterion of step.criteria) criteria[criterion.status]++;
    if (!step.complete) confirmation.unfinished++;
    else if (step.confirmation === "AI") confirmation.ai++;
    else if (step.confirmation === "manual") confirmation.manual++;
    else confirmation.other++;
  }
  const evidence = { ai: 0, operator: 0, system: 0, simulated: 0 };
  for (const event of review?.events ?? []) {
    if (event.source_id !== review?.source_id) continue;
    if (event.simulated) evidence.simulated++;
    else evidence[event.provenance]++;
  }
  return {
    criteria, confirmation, evidence,
    criteriaTotal: Object.values(criteria).reduce((sum, count) => sum + count, 0),
    completed: stages.length - confirmation.unfinished,
    evidenceTotal: Object.values(evidence).reduce((sum, count) => sum + count, 0),
  };
}

/** References are local to this source/review snapshot, and independent of UI filters. */
export function reportReferences(review: ReviewResponse | null) {
  const events = (review?.events ?? []).filter(event => event.source_id === review?.source_id)
    .slice().sort((a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(events.map((event, index) => [event.id, { event, label: `E${String(index + 1).padStart(2, "0")}` }]));
}

export function currentReportReference(event: ReviewEvent, review: ReviewResponse) {
  return event.source_id === review.source_id && !event.old_reference && event.reference_key === review.reference_key;
}

export function reportScope(review: ReviewResponse | null) {
  const counts = { current: 0, earlier: 0, overview: 0, simulated: 0 };
  for (const event of review?.events ?? []) {
    if (event.source_id !== review?.source_id) continue;
    if (event.simulated) counts.simulated++;
    else if (event.observation_scope === "overview") counts.overview++;
    else if (!currentReportReference(event, review!)) counts.earlier++;
    else counts.current++;
  }
  return counts;
}

export function reportReviewQueue(stages: readonly Stage[]) {
  return stages.flatMap(step => {
    const criteria = step.criteria.filter(criterion => criterion.status !== "met");
    if (!criteria.length) return [];
    return [{ step, criteria, counts: {
      not_met: criteria.filter(criterion => criterion.status === "not_met").length,
      partial: criteria.filter(criterion => criterion.status === "partial").length,
      unknown: criteria.filter(criterion => criterion.status === "unknown").length,
    } }];
  }).sort((a, b) => {
    const rank = (counts: { not_met: number; partial: number }) => counts.not_met ? 0 : counts.partial ? 1 : 2;
    return rank(a.counts) - rank(b.counts);
  });
}

export function reportTimelineData(review: ReviewResponse | null) {
  const duration = review?.source_duration_s;
  const durationKnown = typeof duration === "number" && Number.isFinite(duration) && duration > 0;
  const all = reportMoments(review);
  const moments = durationKnown ? all.filter(event => event.video_time_s <= duration) : all;
  const invalidTimestampCount = (review?.events ?? []).filter(event => event.source_id === review?.source_id && !event.simulated &&
    event.observation_scope !== "overview" && (!Number.isFinite(event.video_time_s) || event.video_time_s < 0)).length;
  return { moments, durationKnown, end: durationKnown ? duration : moments.at(-1)?.video_time_s ?? 0,
    outOfRangeCount: all.length - moments.length, invalidTimestampCount };
}
