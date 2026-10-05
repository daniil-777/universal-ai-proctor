import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  parseDocument,
  rowsToWorkflow,
  ObservationSchema,
  workflowContext,
} from "../src/domain/guidance.js";
import { clearProgress, mergeObservation } from "../src/domain/progress.js";
import { SessionStore } from "../src/domain/session.js";
import {
  decodeFrames,
  FrameBody,
  GuidanceEngine,
} from "../src/pipeline/guidance.js";
import { texturedFrame } from "./fixtures.js";
import { extractJson } from "../src/llm/jsonExtract.js";

const library = path.resolve("../guidance-library");
const source = path.resolve("../../AI-Proctor/llmDescription");
export const document =
  "Safety\nAlways check the work area.\nStep 1 — Prepare\nActions: Place the tool on the table.\nCriteria: Tool visibly on table.\nStep 2 — Finish\nActions: Put the tool away.\nCriteria: Tool visibly stored.";
const makeObservation = (
  confidence = 0.9,
  status = "met",
  evidence = "Tool is visible on the table",
) =>
  ObservationSchema.parse({
    summary: "Tool visible",
    guidance: "Review the next action",
    steps: [
      {
        id: "S1",
        confidence,
        criteria: [{ key: "S1C1", status, evidence, frame_indices: [0] }],
      },
    ],
  });
const stores: SessionStore[] = [];
const makeSession = () => {
  const store = new SessionStore();
  stores.push(store);
  const s = store.get(crypto.randomUUID());
  const parsed = parseDocument("Assembly.txt", document);
  s.text = document;
  s.rows = parsed.rows;
  s.workflow = parsed.workflow;
  return s;
};
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => s.clear());
});

describe("document extraction", () => {
  for (const filename of fs
    .readdirSync(library)
    .filter((f) => f.endsWith(".txt")))
    it(`extracts ${filename} into unknown, editable steps`, () => {
      const raw = fs.readFileSync(path.join(library, filename), "utf8");
      const parsed = parseDocument(filename, raw);
      expect(parsed.workflow.steps.length).toBeGreaterThan(0);
      expect(
        parsed.workflow.steps.every(
          (s) =>
            !s.complete &&
            s.progress === 0 &&
            s.criteria.every((c) => c.status === "unknown"),
        ),
      ).toBe(true);
      const count = raw
        .split(/\r?\n/)
        .filter((l) =>
          /^\s*(?:step|stage|phase|task)\s*\d+\s*[:.)—–-]?\s*.+$/i.test(l),
        ).length;
      if (count) expect(parsed.workflow.steps).toHaveLength(count);
      if (fs.existsSync(path.join(source, filename)))
        expect(fs.readFileSync(path.join(library, filename))).toEqual(
          fs.readFileSync(path.join(source, filename)),
        );
    });
  it("retains actions, tools, criteria and safety principles", () => {
    const p = parseDocument("demo.txt", document);
    expect(p.workflow.steps).toHaveLength(2);
    expect(p.workflow.steps[0]?.actions).toEqual([
      "Place the tool on the table.",
    ]);
    expect(p.workflow.principles).toContain("Always check the work area.");
    expect(p.workflow.steps[0]?.criteria[0]?.label).toBe(
      "Tool visibly on table.",
    );
  });
  it("keeps numbered criteria inside explicit steps", () => {
    const p = parseDocument(
      "a.txt",
      "Step 1: Prepare\nCriteria\n1. Item visible\n2. Workspace clear\nStep 2: Finish\nActions\nStore the item",
    );
    expect(p.rows).toHaveLength(2);
    expect(p.workflow.steps[0]?.criteria).toHaveLength(2);
  });
  it("retains multiline surgical constraints and both division subsections without turning caution into proof", () => {
    const text = fs.readFileSync(
      path.join(library, "Cholecystectomy.txt"),
      "utf8",
    );
    const workflow = parseDocument("Cholecystectomy.txt", text).workflow;
    expect(workflow.steps).toHaveLength(6);
    expect(
      workflow.steps.every(
        (step) =>
          step.actions.length &&
          step.criteria.length &&
          step.expectedInstruments.length,
      ),
    ).toBe(true);
    expect(workflow.principles).toContain(
      "Dissection must remain: Close to gallbladder wall. Above Rouvière’s sulcus plane.",
    );
    expect(workflow.principles).toContain("If any doubt → do not proceed.");
    expect(
      workflow.steps[2].criteria.some((criterion) =>
        /If any doubt/.test(criterion.label),
      ),
    ).toBe(false);
    expect(workflow.steps[3].actions).toContain("7B — Cystic Artery Division");
    expect(
      workflow.steps[3].criteria.some(
        (criterion) => criterion.label === "No pulsatile bleeding",
      ),
    ).toBe(true);
  });
  it("ends multiline principle continuation at the next field or step", () => {
    const workflow = parseDocument(
      "process.txt",
      "Step 1: Prepare\nActions\nTools must remain:\nDry.\nWithin reach.\nCriteria\nTool visibly present.\nStep 2: Finish\nActions\nStore tool.",
    ).workflow;
    expect(workflow.principles).toEqual([
      "Tools must remain: Dry. Within reach.",
    ]);
    expect(workflow.steps[0].criteria[0].label).toBe("Tool visibly present.");
    expect(workflow.steps[1].actions).toEqual(["Store tool."]);
  });
  it("supports numbered, prose, Markdown, BOM and CRLF documents", () => {
    for (const text of [
      "1. Prepare\n2. Finish",
      "Prepare the work area. Store the tool.",
      "## Prepare\nPlace the tool\n## Finish\nStore the tool",
      "\uFEFFStep 1: Prepare\r\nActions: Place the tool",
    ]) {
      const p = parseDocument("a.md", text);
      expect(p.rows.length).toBeGreaterThan(0);
      expect(p.workflow.steps[0]?.actions.length).toBeGreaterThan(0);
    }
  });
  it("parses quoted CSV with multiline fields and escaped quotes", () => {
    const p = parseDocument(
      "a.csv",
      'step,actions,criteria\n"Prepare, inspect","Place the tool\nCheck \\"area\\"",Visible tool'.replace(
        /\\"/g,
        '""',
      ),
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]?.step).toBe("Prepare, inspect");
    expect(p.rows[0]?.actions).toContain('Check "area"');
  });
  it("parses TSV and handles empty documents", () => {
    expect(
      parseDocument("a.tsv", "step\tactions\nPrepare\tPlace tool").rows[0]
        ?.actions,
    ).toBe("Place tool");
    expect(parseDocument("", "").rows).toEqual([]);
  });
  it("bounds steps and context without silently omitting IDs", () => {
    const p = parseDocument(
      "a.txt",
      Array.from(
        { length: 130 },
        (_, i) => `Step ${i + 1}: Action ${i + 1}\nActions: Do action`,
      ).join("\n"),
    );
    expect(p.workflow.steps).toHaveLength(100);
    expect(workflowContext(p.workflow, "S50", "x".repeat(20000))).toContain(
      '"id":"S100"',
    );
  });
});

describe("evidence-based progress", () => {
  it("requires two high-confidence observations at distinct timestamps", () => {
    let w = parseDocument("a.txt", document).workflow;
    const votes = new Map();
    w = mergeObservation(w, makeObservation(), 1, votes, [
      { hash: "a", time: 1 },
    ]).workflow;
    expect(w.steps[0]?.complete).toBe(false);
    expect(w.steps[0]?.progress).toBe(50);
    w = mergeObservation(w, makeObservation(), 1, votes, [
      { hash: "a", time: 1 },
    ]).workflow;
    expect(w.steps[0]?.complete).toBe(false);
    w = mergeObservation(w, makeObservation(), 1.3, votes, [
      { hash: "b", time: 1.3 },
    ]).workflow;
    expect(w.steps[0]?.complete).toBe(true);
    expect(w.steps[1]?.progress).toBe(0);
  });
  it("never confirms from low-confidence or missing evidence", () => {
    for (const observation of [
      makeObservation(0.6),
      makeObservation(0.9, "met", ""),
    ]) {
      let w = parseDocument("a.txt", document).workflow;
      const votes = new Map();
      for (let i = 0; i < 4; i++)
        w = mergeObservation(w, observation, i, votes).workflow;
      expect(w.steps[0]?.complete).toBe(false);
    }
  });
  it.each([
    "Partial mobilization observed, but full 25-33% elevation not confirmed.",
    "The lower section is likely being mobilized.",
    "Unable to verify tool placement.",
  ])(
    "does not confirm self-contradictory or speculative evidence: %s",
    (evidence) => {
      let w = parseDocument("a.txt", document).workflow;
      const votes = new Map();
      const observation = makeObservation(0.95, "met", evidence);
      for (let i = 1; i <= 3; i++)
        w = mergeObservation(w, observation, i, votes, [
          { hash: `independent-${i}`, time: i },
        ]).workflow;
      expect(w.steps[0]?.complete).toBe(false);
      expect(w.steps[0]?.progress).toBe(0);
      expect(votes.size).toBe(0);
    },
  );
  it("requires new corroboration after an explicitly unverified observation", () => {
    let w = parseDocument("a.txt", document).workflow;
    const votes = new Map();
    w = mergeObservation(w, makeObservation(), 1, votes, [
      { hash: "first", time: 1 },
    ]).workflow;
    w = mergeObservation(
      w,
      makeObservation(0.9, "unknown", "View obstructed"),
      2,
      votes,
      [{ hash: "obstructed", time: 2 }],
    ).workflow;
    w = mergeObservation(w, makeObservation(), 3, votes, [
      { hash: "clear-again", time: 3 },
    ]).workflow;
    expect(w.steps[0]?.complete).toBe(false);
    expect(votes.get("S1C1")?.count).toBe(1);
  });
  it("ignores unknown IDs and preserves manual confirmation", () => {
    const w = parseDocument("a.txt", document).workflow;
    w.steps[0]!.complete = true;
    w.steps[0]!.confirmation = "manual";
    const result = mergeObservation(
      w,
      makeObservation(0.9, "not_met"),
      1,
      new Map(),
    );
    expect(result.workflow.steps[0]?.complete).toBe(true);
    const invalid = ObservationSchema.parse({
      summary: "unknown",
      guidance: "unknown",
      steps: [
        {
          id: "S99",
          confidence: 1,
          criteria: [{ key: "S99C1", status: "met", evidence: "invented" }],
        },
      ],
    });
    expect(
      mergeObservation(w, invalid, 2, new Map()).workflow.steps[1]?.progress,
    ).toBe(0);
  });
  it("reset removes evidence, confidence and all confirmation", () => {
    const w = mergeObservation(
      parseDocument("a.txt", document).workflow,
      makeObservation(),
      1,
      new Map(),
    ).workflow;
    const reset = clearProgress(w);
    expect(reset.steps[0]?.criteria[0]?.status).toBe("unknown");
    expect(reset.steps[0]?.confidence).toBe(0);
    expect(reset.steps[0]?.criteria[0]?.evidence).toBeUndefined();
  });
});

describe("session and analysis lifecycle", () => {
  it("uses overview images for discovery without counting them as progress", async () => {
    const s = makeSession();
    const engine = new GuidanceEngine(async () =>
      JSON.stringify(makeObservation()),
    );
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({ frames_b64: [jpeg], infer_overview: true });
    await engine.analyze(s, { ...b, current_s: 1 });
    await engine.analyze(s, { ...b, current_s: 2 });
    expect(s.workflow.steps[0]?.progress).toBe(0);
    expect(s.votes.size).toBe(0);
  });
  it("includes the analysis region and settings in duplicate detection", async () => {
    const s = makeSession();
    const complete = vi.fn(async () => JSON.stringify(makeObservation()));
    const engine = new GuidanceEngine(complete);
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({ frames_b64: [jpeg] });
    await engine.analyze(s, b);
    await engine.analyze(s, { ...b, crop_rect: [0, 0, 0.5, 1] });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("rediscovers an inferred workflow when the input changes", async () => {
    const s = makeSession();
    s.workflow = rowsToWorkflow([], "Visual guidance", "none");
    let discover = true;
    const engine = new GuidanceEngine(async () =>
      JSON.stringify({
        ...makeObservation(),
        discovered_steps: discover
          ? [
              {
                step: "Old task",
                actions: "Place tool",
                criteria: "Visible tool",
              },
            ]
          : [],
      }),
    );
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({ frames_b64: [jpeg], source_id: "video-one" });
    await engine.analyze(s, b);
    expect(s.workflow.source).toBe("inferred");
    discover = false;
    await engine.analyze(s, { ...b, source_id: "video-two" });
    expect(s.workflow.steps).toEqual([]);
  });
  it("isolates sessions and evicts expired ones", () => {
    vi.useFakeTimers();
    const store = new SessionStore(100, 2);
    stores.push(store);
    const a = store.get(crypto.randomUUID());
    a.text = "private";
    const b = store.get(crypto.randomUUID());
    expect(b.text).toBe("");
    vi.advanceTimersByTime(101);
    store.sweep();
    expect(store.size).toBe(0);
  });
  it("enforces the session count bound", () => {
    const store = new SessionStore(100000, 2);
    stores.push(store);
    for (let i = 0; i < 3; i++) store.get(crypto.randomUUID());
    expect(store.size).toBe(2);
  });
  it("decodes, compresses, crops and mosaics bounded images", async () => {
    const jpeg = await sharp({
      create: { width: 100, height: 80, channels: 3, background: "red" },
    })
      .jpeg()
      .toBuffer();
    const b = FrameBody.parse({
      frames_b64: [jpeg.toString("base64")],
      crop_rect: [0, 0, 0.5, 1],
    });
    const frames = await decodeFrames(b);
    expect((await sharp(frames[0]).metadata()).width).toBe(50);
    const mosaic = await decodeFrames(
      FrameBody.parse({
        frames_b64: [jpeg.toString("base64"), jpeg.toString("base64")],
        processing: "mosaic",
      }),
    );
    expect(mosaic).toHaveLength(1);
    await expect(
      decodeFrames(FrameBody.parse({ frames_b64: ["invalid"] })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
  it("caches duplicates and confirms real repeated observations", async () => {
    const s = makeSession();
    const complete = vi.fn(async () => JSON.stringify(makeObservation()));
    const engine = new GuidanceEngine(complete);
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({
      source_id: "video",
      current_s: 1,
      frames_b64: [jpeg],
    });
    await engine.analyze(s, b);
    expect((await engine.analyze(s, b)).cached).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    await engine.analyze(s, {
      ...b,
      current_s: 2,
      frames_b64: [await texturedFrame(1)],
    });
    expect(s.workflow.steps[0]?.complete).toBe(true);
    expect(s.workflow.steps[1]?.complete).toBe(false);
  });
  it("restores earlier evidence after rewind and clears on a new source", async () => {
    const s = makeSession();
    const engine = new GuidanceEngine(async () =>
      JSON.stringify(makeObservation()),
    );
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({ source_id: "video", frames_b64: [jpeg] });
    await engine.analyze(s, { ...b, current_s: 2 });
    await engine.analyze(s, {
      ...b,
      current_s: 4,
      frames_b64: [await texturedFrame(1)],
    });
    expect(s.workflow.steps[0]?.complete).toBe(true);
    await engine.analyze(s, { ...b, current_s: 0 });
    expect(s.workflow.steps[0]?.complete).toBe(false);
    await engine.analyze(s, { ...b, source_id: "camera", current_s: 10 });
    expect(s.workflow.steps[0]?.complete).toBe(false);
  });
  it("rejects stale revisions, invalid AI JSON and absent input", async () => {
    const s = makeSession();
    const engine = new GuidanceEngine(async () => "invalid");
    await expect(
      engine.analyze(s, FrameBody.parse({ revision: 9 })),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(engine.analyze(s, FrameBody.parse({}))).rejects.toMatchObject({
      statusCode: 400,
    });
    const jpeg = await texturedFrame();
    await expect(
      engine.analyze(s, FrameBody.parse({ frames_b64: [jpeg] })),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(s.stats.checks).toBe(0);
  });
  it("deduplicates in-flight requests and rejects overlapping different views", async () => {
    const s = makeSession();
    let release: (s: string) => void = () => {};
    const complete = vi.fn(() => new Promise<string>((r) => (release = r)));
    const engine = new GuidanceEngine(complete);
    const jpeg = await texturedFrame();
    const b = FrameBody.parse({ frames_b64: [jpeg], current_s: 1 });
    const first = engine.analyze(s, b);
    const second = engine.analyze(s, b);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    await expect(
      engine.analyze(s, { ...b, current_s: 2 }),
    ).rejects.toMatchObject({ statusCode: 429 });
    release(JSON.stringify(makeObservation()));
    expect(await first).toEqual(await second);
  });
  it("does not commit results after a workflow mutation or abort", async () => {
    for (const abort of [false, true]) {
      const s = makeSession();
      let release: (s: string) => void = () => {};
      let entered: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const engine = new GuidanceEngine(
        () =>
          new Promise<string>((r) => {
            release = r;
            entered();
          }),
      );
      const jpeg = await texturedFrame();
      const controller = new AbortController();
      const p = engine.analyze(
        s,
        FrameBody.parse({ frames_b64: [jpeg] }),
        controller.signal,
      );
      await started;
      if (abort) controller.abort();
      else s.revision++;
      release(JSON.stringify(makeObservation()));
      await expect(p).rejects.toThrow();
      expect(s.stats.checks).toBe(0);
    }
  });
  it("infers provisional steps only when no document exists", async () => {
    const s = makeSession();
    s.workflow = rowsToWorkflow([]);
    const engine = new GuidanceEngine(async () =>
      JSON.stringify({
        ...makeObservation(),
        discovered_steps: [
          { step: "Prepare", actions: "Place tool", criteria: "Tool on table" },
        ],
      }),
    );
    const jpeg = await texturedFrame();
    await engine.analyze(s, FrameBody.parse({ frames_b64: [jpeg] }));
    expect(s.workflow.source).toBe("inferred");
    expect(s.workflow.warnings[0]).toMatch(/Provisional/);
  });
  it("extracts fenced JSON without losing text fields", () => {
    expect(
      extractJson('```json\n{"guidance":"check {visible} tool"}\n```'),
    ).toEqual({ guidance: "check {visible} tool" });
  });
});
