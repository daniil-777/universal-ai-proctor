// Opt-in provider checks against the existing simulator/demo videos. No
// generated ground truth is claimed for clinical actions in simulator footage.
import fs from "node:fs";
import crypto from "node:crypto";
import { sampleWindowFramesFast, probeVideo } from "../dist/pipeline/frames.js";
const base = process.env.GUIDANCE_TEST_URL || "http://127.0.0.1:8101";
async function api(id, route, body, method = body ? "POST" : "GET") {
  const started = performance.now();
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", "x-guidance-session": id },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(50000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
  return { result, elapsed_ms: Math.round(performance.now() - started) };
}
const health = (await api(crypto.randomUUID(), "/api/health")).result;
if (health.mock || !health.providers.openai)
  throw new Error("Configure a real OpenAI provider before this opt-in check.");
const cases = [
  {
    file: "../../AI-Proctor/data/s1_stage.mp4",
    document: "Cholecystectomy.txt",
    name: "Original simulator video with matching procedure reference",
  },
  {
    file: "../../AI-Proctor/data/s1_stage.mp4",
    document: "Coffee_Brewing.txt",
    name: "Original simulator video with unrelated coffee reference",
    mismatch: true,
  },
  {
    file: "../../brag-output/composition/assets/video/sim.mp4",
    document: null,
    name: "Second simulator clip without a document",
  },
  {
    file: "../../brag-output/brag.mp4",
    document: "Coffee_Brewing.txt",
    name: "App demonstration video with unrelated coffee reference",
    mismatch: true,
  },
];
const record = {
  date: new Date().toISOString(),
  note: "Exploratory real-provider integration checks on simulator/demo footage. Expert-annotated process accuracy has not been measured.",
  cases: [],
};
for (const spec of cases) {
  const id = crypto.randomUUID();
  await api(id, "/api/source", {
    source_id: id,
    kind: "video",
    name: spec.name,
  });
  const document = (
    await api(
      id,
      "/api/reference/document",
      {
        text: spec.document
          ? fs.readFileSync(
              new URL(
                `../../guidance-library/${spec.document}`,
                import.meta.url,
              ),
              "utf8",
            )
          : "",
      },
      "PUT",
    )
  ).result;
  const info = await probeVideo(spec.file);
  const end = Math.min(5, info.duration - 0.1);
  let times = [];
  const frames = await sampleWindowFramesFast(
    spec.file,
    Math.max(0, end - 2),
    end,
    2,
    {
      compress: false,
      onSampleTimes: (value) => {
        times = value;
      },
    },
  );
  const { result, elapsed_ms } = await api(id, "/api/guidance/analyze", {
    provider: "openai",
    model_id: "gpt-4o-mini",
    source_id: id,
    revision: document.revision,
    current_s: end,
    frames_b64: frames.map((b) => b.toString("base64")),
    frame_times_s: times,
    vision_detail: "high",
    compress: false,
  });
  const steps = result.workflow.steps.map((s) => ({
    id: s.id,
    name: s.name,
    progress: s.progress,
    complete: s.complete,
  }));
  const checks = {
    single_observation_cannot_confirm: steps.every((s) => !s.complete),
    ...(spec.mismatch
      ? {
          unrelated_reference_remains_unknown: steps.every(
            (s) => s.progress === 0,
          ),
        }
      : {}),
    ...(spec.document
      ? {}
      : {
          workflow_is_provisional:
            result.workflow.source === "inferred" || !steps.length,
        }),
  };
  record.cases.push({
    ...spec,
    elapsed_ms,
    info,
    frame_times_s: times,
    observation: result.observation,
    steps,
    checks,
  });
  console.log(
    JSON.stringify(
      {
        name: spec.name,
        elapsed_ms,
        checks,
        summary: result.observation.summary,
        steps,
      },
      null,
      2,
    ),
  );
}
fs.writeFileSync(
  new URL("../../docs/corpus-live-validation.json", import.meta.url),
  JSON.stringify(record, null, 2) + "\n",
);
if (record.cases.some((c) => Object.values(c.checks).some((ok) => !ok)))
  throw new Error(
    "A real-provider corpus expectation failed; see docs/corpus-live-validation.json.",
  );
