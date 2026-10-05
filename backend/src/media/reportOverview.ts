import type { StructuredHandoff } from "../domain/review.js";

/** Derived display data only: never changes workflow confirmation or review records. */
export function reportOverview(data: StructuredHandoff) {
  const criteria = data.progress.flatMap(step => step.criteria);
  const criteriaGroups = [
    { label: "Met", count: criteria.filter(item => item.status === "met").length, color: "#007D7A" },
    { label: "Partial", count: criteria.filter(item => item.status === "partial").length, color: "#C39856" },
    { label: "Not met", count: criteria.filter(item => item.status === "not_met").length, color: "#B36A56" },
    { label: "Unknown", count: criteria.filter(item => item.status === "unknown").length, color: "#B8C7D1" },
  ];
  const evidenceGroups = [
    { label: "AI observation", count: data.evidence.filter(item => item.provenance === "ai" && !item.simulated).length, color: "#007D7A" },
    { label: "Operator record", count: data.evidence.filter(item => item.provenance === "operator" && !item.simulated).length, color: "#527F9E" },
    { label: "System check", count: data.evidence.filter(item => item.provenance === "system" && !item.simulated).length, color: "#B8C7D1" },
    { label: "Demo / simulated", count: data.evidence.filter(item => item.simulated).length, color: "#C39856" },
  ];
  const unchecked = data.operator_checks.filter(item => !item.checked);
  const rank = { not_met: 0, partial: 1, unknown: 2, met: 3 };
  const issue = data.open_exceptions[0], criterion = data.unresolved_criteria.reduce<(typeof data.unresolved_criteria)[number] | undefined>(
    (best, item) => !best || rank[item.status] < rank[best.status] ? item : best, undefined,
  ), check = unchecked[0];
  const priorities = [
    ...(issue ? [{ kind: "Exception review", count: data.open_exceptions.length, title: issue.title, detail: `${issue.status}${issue.old_reference ? " / Earlier reference" : ""}. Review the recorded issue and document the decision.`, target: "exceptions" }] : []),
    ...(criterion ? [{ kind: "Criterion review", count: data.unresolved_criteria.length, title: criterion.label, detail: `${criterion.step_name} / ${criterion.status.replace(/_/g, " ")}. Review the recorded status and gather suitable evidence before confirming the criterion.`, target: "workflow" }] : []),
    ...(check ? [{ kind: "Preparation review", count: unchecked.length, title: check.label, detail: `${check.kind}. Check the listed preparation item and record the operator decision.`, target: "readiness" }] : []),
  ];
  const moments = data.evidence.filter(event =>
    event.source_id === data.source.id && !event.simulated &&
    event.observation_scope !== "overview" && Number.isFinite(event.video_time_s) &&
    event.video_time_s >= 0,
  ).slice().sort((a, b) => a.video_time_s - b.video_time_s || a.occurred_at - b.occurred_at);
  const lastMoment = moments.at(-1)?.video_time_s ?? 0;
  const timeline = Array.from({ length: 40 }, () => ({ count: 0, status: "ok" as "ok" | "watch" | "alert" }));
  const severity = { ok: 0, watch: 1, alert: 2 };
  for (const event of moments) {
    const bin = timeline[Math.min(39, Math.floor(event.video_time_s / Math.max(1, lastMoment) * 40))]!;
    bin.count++;
    if (severity[event.status] > severity[bin.status]) bin.status = event.status;
  }
  return { criteriaGroups, criteriaTotal: criteria.length, evidenceGroups, priorities, moments, timeline, lastMoment };
}
