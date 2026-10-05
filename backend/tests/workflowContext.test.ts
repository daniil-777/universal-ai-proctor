import { describe, expect, it } from "vitest";
import { parseDocument, workflowContext } from "../src/domain/guidance.js";

const longReference = Array.from(
  { length: 60 },
  (_, index) =>
    `Step ${index + 1}: Inspect station ${index + 1}\nObjective: Identify station ${index + 1}\nTools: Marker ${index + 1}\nActions: Check marker ${index + 1}\nCriteria: Marker ${index + 1} is visibly attached`,
).join("\n\n");

describe("workflow recognition context", () => {
  it("retains distant stage evidence when playback seeks from the first step", () => {
    const workflow = parseDocument("stations.txt", longReference).workflow;
    const context = JSON.parse(workflowContext(workflow, "S1", longReference));
    expect(context.steps).toHaveLength(60);
    expect(context.steps.find((step: { id: string }) => step.id === "S50")).toMatchObject({
      id: "S50",
      objective: "Identify station 50",
      expected_instruments: ["Marker 50"],
      actions: ["Check marker 50"],
      criteria: [{ key: "S50C1", label: "Marker 50 is visibly attached", status: "unknown" }],
    });
    expect(context.steps.at(-1).criteria[0].key).toBe("S60C1");
  });

  it("preserves reference stop conditions and manual state without modifying the workflow", () => {
    const reference = `${longReference}\n\nPrinciples:\n- Stop if the prerequisite cannot be verified.\nUnparsed operator note: request supervisor inspection before restart.`;
    const workflow = parseDocument("stations.txt", reference).workflow;
    workflow.steps[49]!.criteria[0]!.status = "met";
    workflow.steps[49]!.complete = true;
    workflow.steps[49]!.confirmation = "manual";
    const before = JSON.stringify(workflow);
    const context = JSON.parse(workflowContext(workflow, "S1", reference));
    expect(context.document).toBe(reference);
    expect(context.principles).toContain("Stop if the prerequisite cannot be verified.");
    expect(context.steps[49].complete).toBe(true);
    expect(context.steps[49].criteria[0].status).toBe("met");
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it("keeps all extracted criteria available when the existing raw-document cap applies", () => {
    const workflow = parseDocument("stations.txt", longReference).workflow;
    const context = JSON.parse(workflowContext(workflow, "S1", "x".repeat(20000)));
    expect(context.document).toBe("");
    expect(context.document_excerpt_note).toContain("all steps");
    expect(context.steps.at(-1).criteria[0]).toMatchObject({ key: "S60C1", label: "Marker 60 is visibly attached" });
  });
});
