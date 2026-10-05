import type { ChatMessage, Stage } from "./types";
import type { ReviewEvent, ReviewResponse } from "./reviewTypes";

export function formatReportTime(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const reportProvenance = (event: ReviewEvent) =>
  event.simulated ? "Demo / simulated" : event.provenance === "ai"
    ? "AI observation" : event.provenance === "system" ? "System check" : "Operator record";

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
