import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import sharp from "sharp";
import { parseDocument, ObservationSchema } from "../src/domain/guidance.js";
import { mergeObservation } from "../src/domain/progress.js";
import { SessionStore } from "../src/domain/session.js";
import { FrameBody, GuidanceEngine } from "../src/pipeline/guidance.js";
import {
  observationFormat,
  supportsObservationSchema,
} from "../src/llm/observationFormat.js";
import { modelSelection } from "../src/config.js";
import { fixtureDocument, texturedFrame } from "./fixtures.js";
const stores: SessionStore[] = [];
function session() {
  const store = new SessionStore();
  stores.push(store);
  const s = store.get(crypto.randomUUID());
  const document = parseDocument("assembly.txt", fixtureDocument);
  s.workflow = document.workflow;
  s.rows = document.rows;
  s.text = fixtureDocument;
  return s;
}
function observation(indices = [0], current = "S1") {
  return ObservationSchema.parse({
    summary: "Visible tool",
    guidance: "Review next action",
    current_step_id: current,
    steps: [
      {
        id: "S1",
        confidence: 0.9,
        criteria: [
          {
            key: "S1C1",
            status: "met",
            evidence: "Tool visible",
            frame_indices: indices,
          },
        ],
      },
    ],
  });
}
afterEach(() => stores.splice(0).forEach((s) => s.clear()));
describe("visual evidence regressions", () => {
  it("does not confirm the same image at later timestamps", () => {
    const s = session();
    for (const time of [1, 2, 3, 4])
      s.workflow = mergeObservation(s.workflow, observation(), time, s.votes, [
        { hash: "same-image", time },
      ]).workflow;
    expect(s.workflow.steps[0]!.complete).toBe(false);
    expect(s.votes.get("S1C1")!.count).toBe(1);
  });
  it("requires explicit frame references and keeps unsupported progress unknown", () => {
    const s = session();
    for (const time of [1, 2])
      s.workflow = mergeObservation(
        s.workflow,
        observation([]),
        time,
        s.votes,
        [{ hash: String(time), time }],
      ).workflow;
    expect(s.workflow.steps[0]!.progress).toBe(0);
    expect(s.workflow.steps[0]!.confidence).toBe(0);
    expect(s.workflow.steps[0]!.lastObservedS).toBeUndefined();
  });
  it("ignores old, future and nonexistent frame evidence", () => {
    for (const [indices, frameTime] of [
      [[0], 0],
      [[0], 20],
      [[8], 10],
    ] as const) {
      const s = session();
      const merged = mergeObservation(
        s.workflow,
        observation([...indices]),
        10,
        s.votes,
        [{ hash: "fresh", time: frameTime }],
      );
      expect(merged.workflow.steps[0]!.progress).toBe(0);
      expect(s.votes.size).toBe(0);
    }
  });
  it("expires old confirmation votes before accepting later evidence", () => {
    const s = session();
    s.workflow = mergeObservation(s.workflow, observation(), 1, s.votes, [
      { hash: "a", time: 1 },
    ]).workflow;
    s.workflow = mergeObservation(s.workflow, observation(), 50, s.votes, [
      { hash: "b", time: 50 },
    ]).workflow;
    expect(s.workflow.steps[0]!.complete).toBe(false);
    expect(s.votes.get("S1C1")!.count).toBe(1);
  });
  it("does not jump to an unsupported suggested step", () => {
    const s = session();
    const result = mergeObservation(
      s.workflow,
      observation([0], "S2"),
      1,
      s.votes,
      [{ hash: "a", time: 1 }],
    );
    expect(result.currentId).toBe("S1");
  });
  it("ignores a current-step suggestion supported only by an invented criterion", () => {
    const s = session();
    const seen = observation([0], "S2");
    seen.steps[0]!.id = "S2";
    const result = mergeObservation(s.workflow, seen, 1, s.votes, [
      { hash: "a", time: 1 },
    ]);
    expect(result.currentId).toBe("");
  });
  it("preserves independently observed completion after the action leaves view", () => {
    const s = session();
    for (const time of [1, 2])
      s.workflow = mergeObservation(s.workflow, observation(), time, s.votes, [
        { hash: String(time), time },
      ]).workflow;
    s.workflow = mergeObservation(
      s.workflow,
      ObservationSchema.parse({
        summary: "No tool visible",
        guidance: "Continue",
        steps: [],
      }),
      3,
      s.votes,
      [],
    ).workflow;
    expect(s.workflow.steps[0]!.complete).toBe(true);
    expect(s.workflow.steps[1]!.progress).toBe(0);
  });
  it("does not identify a later step from negative evidence alone", () => {
    const s = session();
    const seen = observation([0], "S2");
    seen.steps[0]!.id = "S2";
    seen.steps[0]!.criteria[0]!.key = "S2C1";
    seen.steps[0]!.criteria[0]!.status = "not_met";
    const result = mergeObservation(s.workflow, seen, 1, s.votes, [
      { hash: "a", time: 1 },
    ]);
    expect(result.currentId).toBe("");
    expect(result.workflow.steps[1]!.criteria[0]!.status).toBe("not_met");
  });
  it("chooses a supported visible step when the suggested next step has no evidence", () => {
    const s = session();
    const seen = observation([0], "S3");
    seen.steps[0]!.id = "S2";
    seen.steps[0]!.criteria[0]!.key = "S2C1";
    const result = mergeObservation(s.workflow, seen, 3, s.votes, [
      { hash: "b", time: 3 },
    ]);
    expect(result.currentId).toBe("S2");
    expect(result.workflow.steps[0]!.progress).toBe(0);
  });
});
describe("analysis transactions and quality", () => {
  it("leaves source and progress intact when a source-change request has invalid images", async () => {
    const s = session();
    s.sourceId = "existing";
    s.workflow.steps[0]!.complete = true;
    const before = structuredClone(s.workflow);
    await expect(
      new GuidanceEngine().analyze(
        s,
        FrameBody.parse({ source_id: "new", frames_b64: ["bad"] }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(s.sourceId).toBe("existing");
    expect(s.workflow).toEqual(before);
  });
  it("does not reuse a cached future state when rewinding to an earlier request", async () => {
    const s = session();
    const engine = new GuidanceEngine(async () =>
      JSON.stringify(observation()),
    );
    const first = FrameBody.parse({
      source_id: "video",
      current_s: 1,
      frames_b64: [await texturedFrame()],
    });
    await engine.analyze(s, first);
    await engine.analyze(s, {
      ...first,
      current_s: 2,
      frames_b64: [await texturedFrame(1)],
    });
    expect(s.workflow.steps[0]!.complete).toBe(true);
    const result = await engine.analyze(s, first);
    expect(result.cached).not.toBe(true);
    expect(s.lastTime).toBe(1);
    expect(s.workflow.steps[0]!.complete).toBe(false);
  });
  it("leaves rewind history and completion intact when model output is invalid", async () => {
    const s = session();
    s.sourceId = "existing";
    s.lastTime = 10;
    s.workflow.steps[0]!.complete = true;
    await expect(
      new GuidanceEngine(async () => "bad json").analyze(
        s,
        FrameBody.parse({
          source_id: "existing",
          current_s: 9.5,
          frames_b64: [await texturedFrame()],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(s.workflow.steps[0]!.complete).toBe(true);
    expect(s.lastTime).toBe(10);
  });
  it("rejects malformed and future frame timelines", async () => {
    for (const times of [[], [5], [0, 2]]) {
      const s = session();
      await expect(
        new GuidanceEngine().analyze(
          s,
          FrameBody.parse({
            current_s: 1,
            frames_b64: [await texturedFrame()],
            frame_times_s: times,
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(s.stats.checks).toBe(0);
    }
  });
  it("does not call AI or invent progress for uniform/covered images", async () => {
    const s = session();
    const complete = vi.fn(async () => JSON.stringify(observation()));
    const frame = (
      await sharp({
        create: { width: 640, height: 360, channels: 3, background: "black" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const result = await new GuidanceEngine(complete).analyze(
      s,
      FrameBody.parse({ frames_b64: [frame] }),
    );
    expect(result.image_quality).toBe("unusable");
    expect((result.observation as { status: string }).status).toBe("watch");
    expect(complete).not.toHaveBeenCalled();
    expect(s.workflow.steps[0]!.progress).toBe(0);
  });
  it("keeps only the latest mosaic tiles with matching timestamps", async () => {
    const s = session();
    const complete = vi.fn(async (input) => {
      expect(input.prompt).toContain("[5,6,7,8]");
      expect(input.frames).toHaveLength(1);
      return JSON.stringify(observation([3]));
    });
    await new GuidanceEngine(complete).analyze(
      s,
      FrameBody.parse({
        current_s: 8,
        frames_b64: await Promise.all(
          Array.from({ length: 9 }, (_, i) => texturedFrame(i)),
        ),
        frame_times_s: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        processing: "mosaic",
        mosaic_n: 2,
      }),
    );
    expect(s.votes.get("S1C1")!.timestamp).toBe(8);
  });
  it("passes the detail profile to the provider", async () => {
    const s = session();
    const complete = vi.fn(async () => JSON.stringify(observation()));
    await new GuidanceEngine(complete).analyze(
      s,
      FrameBody.parse({
        frames_b64: [await texturedFrame()],
        vision_detail: "high",
        compress: false,
      }),
    );
    expect(complete.mock.calls[0]![0]).toMatchObject({
      vision_detail: "high",
      json: true,
    });
  });
  it("rejects an aborted refinement without changing the document", async () => {
    const s = session();
    const controller = new AbortController();
    const engine = new GuidanceEngine(async () => {
      controller.abort();
      return JSON.stringify({ title: "Changed", steps: [{ step: "Changed" }] });
    });
    await expect(engine.extract(s, {}, controller.signal)).rejects.toThrow();
    expect(s.workflow.title).toBe("assembly");
    expect(s.revision).toBe(0);
  });
  it("does not silently truncate oversized AI refinement", async () => {
    const s = session();
    s.text = "x".repeat(100001);
    await expect(new GuidanceEngine().extract(s, {})).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(s.text).toHaveLength(100001);
  });
});
describe("document completeness", () => {
  it("warns explicitly when workflow limits are exceeded", () => {
    const p = parseDocument(
      "long.txt",
      Array.from(
        { length: 101 },
        (_, i) => `Step ${i + 1}: Action ${i + 1}\nActions: Visible action`,
      ).join("\n"),
    );
    expect(p.workflow.steps).toHaveLength(100);
    expect(p.workflow.warnings.join(" ")).toContain("first 100");
    expect(p.rows).toHaveLength(101);
  });
  it("rejects unclosed CSV fields", () => {
    expect(() =>
      parseDocument("bad.csv", 'step,actions\n"Prepare,do action'),
    ).toThrow(/unclosed/);
  });
});

describe("provider selection", () => {
  it("never silently substitutes a different requested provider", () => {
    expect(modelSelection("google").provider).toBe("google");
    expect(modelSelection("claude").provider).toBe("anthropic");
  });
  it("resolves a known model without silently replacing it", () => {
    expect(modelSelection(undefined, "gpt-4o").model_id).toBe("gpt-4o");
    expect(() => modelSelection("unknown")).toThrow(/Unknown/);
  });
});

describe("structured provider observations", () => {
  it("requires all top-level and criterion fields in the provider schema", () => {
    const schema = observationFormat.json_schema.schema as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        steps: {
          items: {
            properties: {
              criteria: {
                items: { required: string[]; additionalProperties: boolean };
              };
            };
          };
        };
      };
    };
    expect(observationFormat.json_schema.strict).toBe(true);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("steps");
    expect(schema.required).toContain("concern");
    const criterion = schema.properties.steps.items.properties.criteria.items;
    expect(criterion.required).toContain("frame_indices");
    expect(criterion.additionalProperties).toBe(false);
  });
  it("selects strict schemas only for supported model snapshots", () => {
    expect(supportsObservationSchema("gpt-4o-mini")).toBe(true);
    expect(supportsObservationSchema("gpt-4o-2024-08-06")).toBe(true);
    expect(supportsObservationSchema("gpt-4o-2024-05-13")).toBe(false);
    expect(supportsObservationSchema("custom-model")).toBe(false);
  });
});
