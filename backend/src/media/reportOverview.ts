import type { StructuredHandoff } from "../domain/review.js";

export function reportEvidenceContext(data: StructuredHandoff, event: StructuredHandoff["evidence"][number]) {
  const earlierReference = event.old_reference || event.reference_key !== data.reference.reference_key;
  const canLinkSteps = !earlierReference && event.source_id === data.source.id;
  const steps = canLinkSteps ? data.progress.flatMap((step, index) =>
    event.step_ids.includes(step.id) ? [{ id: step.id, index, name: step.name }] : []) : [];
  const duration = data.source.kind === "video" && data.source.duration_s !== null && Number.isFinite(data.source.duration_s) && data.source.duration_s > 0
    ? data.source.duration_s : null;
  const timelineExclusion = event.source_id !== data.source.id ? "Other source; excluded from this source's timeline."
    : !Number.isFinite(event.video_time_s) || event.video_time_s < 0 ? "No valid video timestamp recorded; excluded from the timeline."
      : duration !== null && event.video_time_s > duration ? "Timestamp is outside this video's duration; excluded from the timeline."
        : "";
  return { earlierReference, steps, timelineExclusion,
    unavailableStepCount: canLinkSteps ? event.step_ids.filter(id => !data.progress.some(step => step.id === id)).length : 0 };
}

/** Derived display data only: never changes workflow confirmation or review records. */
export function reportOverview(data: StructuredHandoff) {
  const sourceEvidence = data.evidence.filter(event => event.source_id === data.source.id);
  const criteria = data.progress.flatMap(step => step.criteria);
  const criteriaGroups = [
    { label: "Met", count: criteria.filter(item => item.status === "met").length, color: "#007D7A" },
    { label: "Partial", count: criteria.filter(item => item.status === "partial").length, color: "#C39856" },
    { label: "Not met", count: criteria.filter(item => item.status === "not_met").length, color: "#B36A56" },
    { label: "Unknown", count: criteria.filter(item => item.status === "unknown").length, color: "#B8C7D1" },
  ];
  const evidenceGroups = [
    { label: "AI observation", count: sourceEvidence.filter(item => item.provenance === "ai" && !item.simulated).length, color: "#007D7A" },
    { label: "Operator record", count: sourceEvidence.filter(item => item.provenance === "operator" && !item.simulated).length, color: "#527F9E" },
    { label: "System check", count: sourceEvidence.filter(item => item.provenance === "system" && !item.simulated).length, color: "#B8C7D1" },
    { label: "Demo / simulated", count: sourceEvidence.filter(item => item.simulated).length, color: "#C39856" },
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
  const durationKnown = data.source.kind === "video" && data.source.duration_s !== null &&
    Number.isFinite(data.source.duration_s) && data.source.duration_s > 0;
  const eligibleMoments = data.evidence.filter(event =>
    event.source_id === data.source.id && !event.simulated &&
    event.observation_scope !== "overview" && Number.isFinite(event.video_time_s) &&
    event.video_time_s >= 0,
  );
  const moments = eligibleMoments.filter(event => !durationKnown || event.video_time_s <= data.source.duration_s!)
    .slice().sort((a, b) => a.video_time_s - b.video_time_s || a.occurred_at - b.occurred_at);
  const lastMoment = moments.at(-1)?.video_time_s ?? 0;
  const timelineEnd = durationKnown ? data.source.duration_s! : lastMoment;
  const outOfRangeCount = eligibleMoments.length - moments.length;
  const invalidTimestampCount = sourceEvidence.filter(event => !event.simulated && event.observation_scope !== "overview" &&
    (!Number.isFinite(event.video_time_s) || event.video_time_s < 0)).length;
  const scopeGroups = [
    { label: "Current instructions", count: 0 }, { label: "Earlier instructions", count: 0 },
    { label: "Whole-video overview", count: 0 }, { label: "Demo / simulated", count: 0 },
  ];
  for (const event of sourceEvidence) {
    const index = event.simulated ? 3 : event.observation_scope === "overview" ? 2 : reportEvidenceContext(data, event).earlierReference ? 1 : 0;
    scopeGroups[index]!.count++;
  }
  const timeline = Array.from({ length: 40 }, () => ({ count: 0, status: "ok" as "ok" | "watch" | "alert" }));
  const severity = { ok: 0, watch: 1, alert: 2 };
  for (const event of moments) {
    const bin = timeline[Math.min(39, Math.floor(event.video_time_s / (timelineEnd > 0 ? timelineEnd : 1) * 40))]!;
    bin.count++;
    if (severity[event.status] > severity[bin.status]) bin.status = event.status;
  }
  const reviewQueue = data.progress.map((step, index) => {
    const notMet = step.criteria.filter(item => item.status === "not_met").length;
    const partial = step.criteria.filter(item => item.status === "partial").length;
    const unknown = step.criteria.filter(item => item.status === "unknown").length;
    return { stepId: step.id, index, name: step.name, complete: step.complete,
      confirmation: step.confirmation, notMet, partial, unknown, total: notMet + partial + unknown };
  }).filter(step => step.total > 0).sort((a, b) =>
    (a.notMet ? 0 : a.partial ? 1 : 2) - (b.notMet ? 0 : b.partial ? 1 : 2) || a.index - b.index);
  // These are references within this snapshot, assigned before display filters.
  // The original IDs and retained records are left unchanged.
  const evidenceReferences = sourceEvidence
    .slice().sort((a, b) => a.occurred_at - b.occurred_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((event, index) => ({ event, label: `E${String(index + 1).padStart(2, "0")}` }));
  return { criteriaGroups, criteriaTotal: criteria.length, evidenceGroups, priorities, moments, timeline, lastMoment,
    timelineEnd, durationKnown, outOfRangeCount, invalidTimestampCount, scopeGroups,
    otherSourceCount: data.evidence.length - sourceEvidence.length, sourceRecords: sourceEvidence.length,
    reviewQueue, evidenceReferences };
}
