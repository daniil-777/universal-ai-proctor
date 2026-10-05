import type { Observation, Step, Workflow } from "./guidance.js";
export interface Confirmation {
  count: number;
  timestamp: number;
  hashes?: string[];
}
export type Confirmations = Map<string, Confirmation>;
export interface EvidenceFrame {
  hash: string;
  time: number;
}
// A model can emit `met` while its own evidence says the requirement is
// unverified. Such contradictory or speculative text cannot cast a vote.
const unverifiedEvidence = /\b(?:cannot|can't|unable to)\s+(?:be\s+)?(?:confirm|verify|establish|determine)\b|\bnot\s+(?:(?:fully|clearly|definitively)\s+)?(?:confirmed|verified|established)\b|\b(?:not yet|has not|have not|is not|are not)\b.{0,70}\b(?:shown|seen|visible|observed|established|demonstrated)\b|\b(?:unconfirmed|uncertain|likely|probably|possibly|presumably|assumed|inferred)\b|\b(?:may|might)\s+be\b/i;
const sequenceRequirement = /\b(?:again|returns?|returned|returning|repetitions?)\b|\bback\s+(?:to|at|on)\b|\b(?:full|complete|completed)\s+(?:movement\s+)?cycle\b/i;
const uncertainPhase = /\b(?:likely|probably|possibly|presumably|assumed)\b|\b(?:phase|stage|episode|identity)\b.{0,40}\b(?:uncertain|unconfirmed|not verified|not clear|ambiguous)\b|\b(?:cannot|can't|unable to)\s+(?:identify|distinguish|determine)\b/i;
export function constrainVisualEvidence(observation: Observation, workflow?: Workflow, frames?: EvidenceFrame[], timestamp?: number): Observation {
  const labels = new Map(workflow?.steps.flatMap(step => step.criteria.map(c => [c.key, c.label] as const)));
  return {
    ...observation,
    steps: observation.steps.map((step) => ({
      ...step,
      criteria: step.criteria.map((criterion) => {
        if (criterion.status !== "met" && criterion.status !== "partial")
          return criterion;
        const unverified = unverifiedEvidence.test(criterion.evidence);
        if (unverified) return { ...criterion, status: "unknown" as const };
        // A return or repetition is a temporal requirement. A held pose cannot
        // establish it, even if the model describes that pose as "again".
        if (criterion.status === "met" && frames && sequenceRequirement.test(`${labels.get(criterion.key) || ""} ${criterion.evidence}`)) {
          const referenced = [...new Set(criterion.frame_indices)].map(i => frames[i]).filter((f): f is EvidenceFrame => !!f && (timestamp === undefined || (timestamp - f.time >= -0.05 && timestamp - f.time <= 30))).sort((a,b) => a.time-b.time);
          if (!referenced.some((a, i) => referenced.slice(i + 1).some(b => b.hash !== a.hash && b.time - a.time >= 0.25)))
            return { ...criterion, status: "unknown" as const };
        }
        if (
          criterion.status === "met" &&
          /\b(?:partial|partially|incomplete)\b/i.test(criterion.evidence)
        )
          return { ...criterion, status: "partial" as const };
        return criterion;
      }),
    })),
  };
}
export function mergeObservation(
  workflow: Workflow,
  observation: Observation,
  timestamp: number,
  votes: Confirmations,
  frames?: EvidenceFrame[],
): { workflow: Workflow; currentId: string } {
  observation = constrainVisualEvidence(observation, workflow, frames, timestamp);
  const byId = new Map(observation.steps.map((s) => [s.id, s]));
  const steps = workflow.steps.map((step): Step => {
    const seen = byId.get(step.id);
    if (!seen || step.confirmation === "manual") return step;
    const byKey = new Map(seen.criteria.map((c) => [c.key, c]));
    let observed = false;
    const criteria = step.criteria.map((c) => {
      const evidence = byKey.get(c.key);
      if (evidence?.status === "unknown") votes.delete(c.key);
      if (
        !evidence ||
        evidence.status === "unknown" ||
        !evidence.evidence.trim() ||
        seen.confidence < 0.55
      )
        return c;
      if (c.status === "met") return c;
      // Missing frame references cannot establish visual completion. Only fresh,
      // independently captured evidence contributes a confirmation vote.
      const referenced = evidence.frame_indices
        .map((i) => frames?.[i])
        .filter(
          (f): f is EvidenceFrame =>
            !!f && timestamp - f.time >= -0.05 && timestamp - f.time <= 1,
        );
      const newest = referenced.sort((a, b) => b.time - a.time)[0];
      if (!newest) return c;
      observed = true;
      if (evidence.status === "met") {
        const previous = votes.get(c.key);
        const validPrevious =
          previous && timestamp - previous.timestamp <= 45
            ? previous
            : undefined;
        const independent =
          newest &&
          !validPrevious?.hashes?.includes(newest.hash) &&
          (!validPrevious || newest.time - validPrevious.timestamp >= 0.25);
        const count =
          seen.confidence >= 0.75 && independent
            ? (validPrevious?.count || 0) + 1
            : validPrevious?.count || 0;
        if (independent && seen.confidence >= 0.75)
          votes.set(c.key, {
            count,
            timestamp: newest.time,
            hashes: [...(validPrevious?.hashes || []), newest.hash].slice(-8),
          });
        const confirmed = count >= 2 && seen.confidence >= 0.75;
        return {
          ...c,
          status: confirmed ? ("met" as const) : ("partial" as const),
          evidence: evidence.evidence,
          confidence: seen.confidence,
          ...(confirmed ? { confirmedAt: timestamp } : {}),
        };
      }
      votes.delete(c.key);
      return {
        ...c,
        status: evidence.status,
        evidence: evidence.evidence,
        confidence: seen.confidence,
      };
    });
    const progress = criteria.length
      ? Math.round(
          (criteria.reduce(
            (n, c) =>
              n + (c.status === "met" ? 1 : c.status === "partial" ? 0.5 : 0),
            0,
          ) /
            criteria.length) *
            100,
        )
      : 0;
    const complete =
      criteria.length > 0 && criteria.every((c) => c.status === "met");
    return {
      ...step,
      criteria,
      progress,
      complete,
      confidence: observed ? seen.confidence : step.confidence,
      lastObservedS: observed ? timestamp : step.lastObservedS,
      ...(complete ? { confirmation: "AI" as const } : {}),
    };
  });
  const suggested = observation.current_step_id;
  const known = new Map(
    workflow.steps.map((step) => [
      step.id,
      {
        index: step.index,
        keys: new Set(step.criteria.map((criterion) => criterion.key)),
      },
    ]),
  );
  const visible = observation.steps.flatMap((step) => {
    const reference = known.get(step.id);
    if (!reference || step.confidence < 0.55) return [];
    const times = step.criteria
      .filter(
        (criterion) =>
          reference.keys.has(criterion.key) &&
          criterion.evidence.trim() &&
          (criterion.status === "met" || criterion.status === "partial"),
      )
      .flatMap((criterion) =>
        criterion.frame_indices
          .map((index) => frames?.[index]?.time)
          .filter(
            (time): time is number =>
              time !== undefined &&
              timestamp - time >= -0.05 &&
              timestamp - time <= 1,
          ),
      );
    return times.length
      ? [{ step, time: Math.max(...times), index: reference.index }]
      : [];
  });
  const supported = (
    visible.find((candidate) => candidate.step.id === suggested) ||
    visible.sort(
      (a, b) =>
        b.time - a.time ||
        b.step.confidence - a.step.confidence ||
        b.index - a.index,
    )[0]
  )?.step;
  const phase = observation.phase_evidence;
  const phaseFrames = phase?.frame_indices.map(i => frames?.[i]);
  const phaseSupported = !!(
    suggested && known.has(suggested) && phase && phase.confidence >= 0.75 &&
    phase.evidence.trim() && !uncertainPhase.test(phase.evidence) && frames?.length &&
    phase.frame_indices.includes(frames.length - 1) && phaseFrames?.length &&
    // Older comparison images may explain why the latest directly visible cue
    // is distinctive. Only the latest view must be fresh; no criterion votes
    // are created from these phase references.
    phaseFrames.every(f => f && timestamp - f.time >= -0.05 &&
      timestamp - f.time <= 30) &&
    timestamp - frames.at(-1)!.time <= 1 &&
    (!phase.continuity || (phaseFrames.length >= 2 &&
      new Set(phaseFrames.map(f => f!.hash)).size >= 2))
  );
  const currentId =
    suggested === null
      ? ""
      : phaseSupported
      ? suggested!
      : supported && steps.some((s) => s.id === supported.id)
      ? supported.id
      : "";
  return { workflow: { ...workflow, steps }, currentId };
}
export function clearProgress(workflow: Workflow): Workflow {
  return {
    ...workflow,
    steps: workflow.steps.map((s) => ({
      ...s,
      progress: 0,
      confidence: 0,
      complete: false,
      confirmation: undefined,
      lastObservedS: undefined,
      criteria: s.criteria.map((c) => ({
        key: c.key,
        label: c.label,
        status: "unknown",
      })),
    })),
  };
}
