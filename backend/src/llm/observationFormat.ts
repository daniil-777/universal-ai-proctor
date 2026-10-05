import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ResponseFormatJSONSchema } from "openai/resources/shared";
import { ObservationSchema, RefRowSchema } from "../domain/guidance.js";
// Provider output requires explicit fields. Input defaults remain useful for
// other providers and demo mode, but are unsuitable for strict JSON schemas.
const stepInput = ObservationSchema.shape.steps.removeDefault().element;
const criterionInput = stepInput.shape.criteria.element;
const criterion = criterionInput.extend({
  evidence: criterionInput.shape.evidence.removeDefault(),
  frame_indices: criterionInput.shape.frame_indices.removeDefault(),
});
const discovered = RefRowSchema.extend({
  objective: RefRowSchema.shape.objective.removeDefault(),
  instruments: RefRowSchema.shape.instruments.removeDefault(),
  actions: RefRowSchema.shape.actions.removeDefault(),
  criteria: RefRowSchema.shape.criteria.removeDefault(),
  duration: RefRowSchema.shape.duration.removeDefault(),
});
const output = ObservationSchema.extend({
  principle: ObservationSchema.shape.principle.removeDefault(),
  current_step_id: ObservationSchema.shape.current_step_id.removeDefault(),
  phase_evidence: ObservationSchema.shape.phase_evidence.unwrap(),
  status: ObservationSchema.shape.status.removeDefault(),
  concern: ObservationSchema.shape.concern.removeDefault(),
  steps: z
    .array(stepInput.extend({ criteria: z.array(criterion).max(40) }))
    .max(100),
  discovered_steps: z.array(discovered).max(30),
});
export const observationFormat: ResponseFormatJSONSchema = zodResponseFormat(
  output,
  "process_observation",
);
// Older/custom models retain JSON mode plus the same server-side validation.
export function supportsObservationSchema(model: string): boolean {
  if (/^gpt-4\.1(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return true;
  if (/^gpt-(?:6-(?:astra|sol|luna)|6\.1-sol)(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
    return true;
  if (model === "gpt-4o" || model === "gpt-4o-mini") return true;
  const snapshot = /^(gpt-4o(?:-mini)?)-(\d{4}-\d{2}-\d{2})$/.exec(model);
  return (
    !!snapshot &&
    snapshot[2]! >=
      (snapshot[1] === "gpt-4o-mini" ? "2024-07-18" : "2024-08-06")
  );
}
