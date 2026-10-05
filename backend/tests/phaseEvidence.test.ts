import { describe, expect, it } from "vitest";
import { ObservationSchema, parseDocument } from "../src/domain/guidance.js";
import { constrainVisualEvidence, mergeObservation } from "../src/domain/progress.js";
import { observationFormat } from "../src/llm/observationFormat.js";

const workflow = () => parseDocument("process.txt", "Step 1: Prepare\nActions:\n- Lift the object.\nCriteria:\n- Object visibly lifted.\nStep 2: Return\nActions:\n- Return the object.\nCriteria:\n- Object is on the surface again.").workflow;
const frames = [{ hash: "lift", time: 3 }, { hash: "rest", time: 10 }];
const observation = () => ObservationSchema.parse({summary:"The current contact is obscured; the earlier lift belongs to this continuing episode.", guidance:"Check contact before confirming completion.", current_step_id:"S2", phase_evidence:{confidence:0.9,evidence:"Earlier distinctive return motion and the latest unchanged scene identify the continuing return episode; final contact is obscured.",frame_indices:[0,1],continuity:true},steps:[]});

describe("phase identity separated from completion", () => {
  it("recognizes an ongoing episode without creating completion evidence or votes", () => {
    const votes = new Map(); const result = mergeObservation(workflow(), observation(), 10, votes, frames);
    expect(result.currentId).toBe("S2"); expect(votes.size).toBe(0);
    expect(result.workflow.steps.every(s => s.progress === 0 && !s.complete)).toBe(true);
  });
  it.each(["unknown-id", "missing-latest", "future", "stale-latest", "held", "low-confidence", "speculative", "overlong-context"])("rejects invalid phase evidence: %s", condition => {
    const seen = observation(); let images = frames;
    if (condition === "unknown-id") seen.current_step_id = "S999";
    if (condition === "missing-latest") seen.phase_evidence!.frame_indices = [0];
    if (condition === "future") images = [frames[0]!, {hash:"future",time:11}];
    if (condition === "stale-latest") images = [frames[0]!, {hash:"stale",time:8}];
    if (condition === "held") images = frames.map(f => ({...f,hash:"same"}));
    if (condition === "low-confidence") seen.phase_evidence!.confidence = .6;
    if (condition === "speculative") seen.phase_evidence!.evidence = "Probably the return phase.";
    if (condition === "overlong-context") images = [{hash:"too-old",time:0},frames[1]!];
    if (condition === "overlong-context") images[1] = {hash:"latest",time:40};
    expect(mergeObservation(workflow(),seen,condition === "overlong-context" ? 40 : 10,new Map(),images).currentId).toBe("");
  });
  it("supports a directly visible latest cue without old context", () => {
    const seen = observation(); seen.phase_evidence!.continuity = false; seen.phase_evidence!.frame_indices = [1];
    expect(mergeObservation(workflow(),seen,10,new Map(),frames).currentId).toBe("S2");
  });
  it("allows historical contrast to explain a distinctive latest cue without claiming continuity", () => {
    const seen=observation(); seen.phase_evidence!.continuity=false;
    seen.phase_evidence!.evidence="The latest image is a circular grayscale view, in contrast to the earlier colored view; no return is verified.";
    const result=mergeObservation(workflow(),seen,10,new Map(),frames);
    expect(result.currentId).toBe("S2"); expect(result.workflow.steps[1]!.progress).toBe(0);
  });
  it("allows a known phase to explicitly admit that completion is not visible", () => {
    const seen = observation(); seen.phase_evidence!.evidence = "The distinctive return movement identifies this continuing episode; final surface contact is not visible.";
    const result=mergeObservation(workflow(),seen,10,new Map(),frames);
    expect(result.currentId).toBe("S2"); expect(result.workflow.steps[1]!.complete).toBe(false);
  });
  it("keeps explicit ambiguity and legacy inputs compatible", () => {
    const seen = observation(); seen.current_step_id = null;
    expect(mergeObservation(workflow(),seen,10,new Map(),frames).currentId).toBe("");
    expect(ObservationSchema.parse({summary:"Visible",guidance:"Check",steps:[]}).phase_evidence).toBeUndefined();
    const schema = observationFormat.json_schema.schema as any;
    expect(schema.required).toContain("phase_evidence");
  });
});
describe("temporal completion requirements", () => {
  const seen = () => ObservationSchema.parse({summary:"An object rests on a surface",guidance:"Verify the return",current_step_id:null,steps:[{id:"S2",confidence:.95,criteria:[{key:workflow().steps[1]!.criteria[0]!.key,status:"met",evidence:"The object rests on the surface",frame_indices:[1]}]}]});
  it("rejects a single resting pose for a return even if the evidence omits the word again", () => {
    expect(constrainVisualEvidence(seen(),workflow(),frames,10).steps[0]!.criteria[0]!.status).toBe("unknown");
    expect(mergeObservation(workflow(),seen(),10,new Map(),frames).workflow.steps[1]!.progress).toBe(0);
  });
  it("rejects repeated images and permits genuinely different ordered sequence references", () => {
    const s=seen(); s.steps[0]!.criteria[0]!.frame_indices=[0,1];
    expect(constrainVisualEvidence(s,workflow(),frames.map(f=>({...f,hash:"held"})),10).steps[0]!.criteria[0]!.status).toBe("unknown");
    expect(constrainVisualEvidence(s,workflow(),frames,10).steps[0]!.criteria[0]!.status).toBe("met");
  });
  it("does not require a sequence for an ordinary visible-state criterion", () => {
    const s=seen(); s.steps[0]!.id="S1"; s.steps[0]!.criteria[0]!.key=workflow().steps[0]!.criteria[0]!.key;
    expect(constrainVisualEvidence(s,workflow(),frames,10).steps[0]!.criteria[0]!.status).toBe("met");
  });
  it("rejects a compound criterion when its own evidence admits a missing subsequent scene", () => {
    const s=seen(); s.steps[0]!.criteria[0]!.evidence="A grayscale view is visible after an operative scene, but the subsequent operative scene has not yet been shown.";
    s.steps[0]!.criteria[0]!.frame_indices=[0,1];
    expect(constrainVisualEvidence(s,workflow(),frames,10).steps[0]!.criteria[0]!.status).toBe("unknown");
  });
});
