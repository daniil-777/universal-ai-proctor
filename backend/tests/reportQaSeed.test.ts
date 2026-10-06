import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { seedReportQa } from "../../scripts/report-qa-data.mjs";
import { ObservationSchema, parseDocument } from "../src/domain/guidance.js";
import { referenceKey } from "../src/domain/review.js";
import { SessionStore } from "../src/domain/session.js";
import { FrameBody, GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureDocument, texturedFrame } from "./fixtures.js";

function previousSession() {
  const session = new SessionStore().get(crypto.randomUUID());
  session.filename = "Previous reference.txt";
  session.text = fixtureDocument;
  const document = parseDocument(session.filename, session.text);
  session.rows = document.rows;
  session.workflow = document.workflow;
  session.sourceId = "synthetic-source";
  session.sourceKind = "video";
  session.currentId = "S1";
  session.lastTime = 30;
  session.votes.set("S1C1", { count: 1, timestamp: 0.1 });
  session.snapshots = [{ time: 0.1, workflow: structuredClone(session.workflow), votes: new Map(session.votes) }];
  session.observations = [{ time: 0.1, value: ObservationSchema.parse({ summary: "Previous reference observation", guidance: "Previous reference guidance", steps: [] }) }];
  session.cache.set("previous", { expires: Date.now() + 60_000, value: session.workflow });
  session.inflight.set("previous", Promise.resolve({}));
  return session;
}

const unchangedObservation = JSON.stringify({
  summary: "Synthetic view; criteria remain unverified.",
  guidance: "Review retained records.", status: "watch", current_step_id: null,
  steps: [], discovered_steps: [],
});

describe("isolated report QA seed lifecycle", () => {
  it("replaces stale engine history with a detached, zero-time fixture baseline", () => {
    const session = previousSession();
    const oldRevision = session.revision;
    const handoff = seedReportQa(session);

    expect(session.revision).toBe(oldRevision + 1);
    expect(session.lastTime).toBe(0);
    expect(session.votes.size).toBe(0);
    expect(session.cache.size).toBe(0);
    expect(session.inflight.size).toBe(0);
    expect(session.observations).toEqual([]);
    expect(session.snapshots).toHaveLength(1);
    expect(session.snapshots[0]!.time).toBe(0);
    expect(session.snapshots[0]!.workflow).toEqual(session.workflow);
    expect(session.snapshots[0]!.workflow).not.toBe(session.workflow);
    expect(session.currentId).toBe("S2");
    expect(session.workflow.steps[0]!.confirmation).toBe("manual");
    expect(session.workflow.steps[1]!.criteria.map(criterion => criterion.status)).toEqual(["not_met", "partial"]);
    expect(handoff.evidence).toHaveLength(7);
    expect(session.review!.exceptions).toHaveLength(4);
  });

  it("keeps the seeded reference and manual confirmation during startup analysis and rollback to zero", async () => {
    const session = previousSession();
    seedReportQa(session);
    const seededWorkflow = structuredClone(session.workflow);
    const seededKey = referenceKey(session);
    const engine = new GuidanceEngine(async () => unchangedObservation);
    const frame = await texturedFrame();
    const body = FrameBody.parse({ source_id: session.sourceId, revision: session.revision, frames_b64: [frame] });

    await engine.analyze(session, { ...body, current_s: 0.43, frame_times_s: [0.43] });
    expect(session.workflow).toEqual(seededWorkflow);
    await engine.analyze(session, { ...body, current_s: 0, frame_times_s: [0] });

    expect(referenceKey(session)).toBe(seededKey);
    expect(session.workflow).toEqual(seededWorkflow);
    expect(session.workflow.steps[0]!.confirmation).toBe("manual");
    expect(session.snapshots.every(snapshot => snapshot.workflow.title === seededWorkflow.title)).toBe(true);
  });

  it("rejects a late pre-seed observation rather than committing the previous definition", async () => {
    const session = previousSession();
    session.inflight.clear();
    let release!: (value: string) => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => { entered = resolve; });
    const engine = new GuidanceEngine(async () => {
      entered();
      return new Promise<string>(resolve => { release = resolve; });
    });
    const frame = await texturedFrame();
    const pending = engine.analyze(session, FrameBody.parse({
      source_id: session.sourceId, revision: session.revision,
      current_s: 30, frames_b64: [frame], frame_times_s: [30],
    }));
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    await barrier;
    seedReportQa(session);
    const seededWorkflow = structuredClone(session.workflow);
    release(unchangedObservation);

    await rejected;
    expect(session.workflow).toEqual(seededWorkflow);
    expect(session.lastTime).toBe(0);
    expect(session.observations).toEqual([]);
  });

  it("does not retain a dangling current step in the empty fixture", () => {
    const session = previousSession();
    seedReportQa(session, "empty");
    expect(session.currentId).toBe("");
    expect(session.snapshots[0]!.workflow.steps).toEqual([]);
    expect(session.review!.events).toEqual([]);
    expect(session.review!.exceptions).toEqual([]);
  });
});
