import type { Session } from "../domain/session.js";

// The visual sampler covers the trailing five seconds. Descriptions from a
// different scene must not anchor a fresh observation after a seek or long gap.
export function observationContext(
  session: Session,
  currentS: number,
  includeHistory = false,
) {
  return session.observations
    .filter(
      ({ time }) =>
        time <= currentS + 0.05 && (includeHistory || currentS - time <= 5),
    )
    .slice(-4)
    .map(({ time, value }) => ({
      time,
      summary: value.summary,
      status: value.status,
      concern: value.concern,
    }));
}

export const VISUAL_GROUNDING_RULE =
  "Inspect the latest image before matching a workflow step. Describe concrete visible objects, tools, materials and visibility changes first; use a generic tool description when the exact type, brand, energy mode or anatomy cannot be distinguished. Expected equipment in the document is not evidence that it is visible. Previous AI descriptions are unverified context, not observations to copy. Visible later-stage objects may support a later current step without proving any skipped earlier criteria. Do not force the first unfinished step onto a different scene. A visible effect alone does not establish its cause: smoke/haze does not prove bleeding, and a dark area does not prove a leak. Calibrate concern severity to actual visible evidence: ambiguous static color or an unclear structure warrants uncertainty or watch, not an invented alert. Use attached frame timestamps to establish changes such as spreading fluid, slipping tools or worsening obstruction; do not infer change from previous AI wording. Respect explicit document stop conditions: when a required prerequisite cannot be verified, explain the limit instead of instructing the user to continue that action.";
