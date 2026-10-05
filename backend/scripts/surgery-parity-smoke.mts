import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { AccountStore } from "../src/account/store.js";
import { parseDocument } from "../src/domain/guidance.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { complete } from "../src/llm/client.js";

// Opt-in: this script performs nine real requests to the configured provider.
if (!process.argv.includes("--live"))
  throw new Error(
    "Use --live to authorize the real-provider surgical training smoke check.",
  );
const store = new SessionStore();
const accounts = new AccountStore({ file: ":memory:" });
let providerCalls = 0;
const app = await createApp({
  store,
  accountStore: accounts,
  engine: new GuidanceEngine(async (input) => {
    providerCalls++;
    return complete(input);
  }),
});
const id = crypto.randomUUID(),
  sourceId = crypto.randomUUID();
const text = await fs.readFile(
  new URL("../../guidance-library/Cholecystectomy.txt", import.meta.url),
  "utf8",
);
const original = await fs.readFile(
  new URL(
    "../../../AI-Proctor/llmDescription/Cholecystectomy.txt",
    import.meta.url,
  ),
  "utf8",
);
const results: any[] = [];
const sessions: any[] = [];
const root = new URL("../../", import.meta.url);
const provider = "openai",
  model = process.argv.includes("--model")
    ? process.argv[process.argv.indexOf("--model") + 1]
    : "gpt-4o-mini";
try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const origin = app.listeningOrigin;
  const api = async (route: string, body?: object) => {
    const start = performance.now();
    const response = await fetch(origin + route, {
      method: body ? "POST" : "GET",
      headers: { "X-Guidance-Session": id, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(55_000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(
        `${route}: ${response.status} ${data.error || data.detail}`,
      );
    return { data, elapsed_ms: Math.round(performance.now() - start) };
  };
  await api("/api/source", {
    source_id: sourceId,
    kind: "video",
    name: "Uncomplicated cholecystectomy",
  });
  const sample = (
    await api("/api/video/load-sample", {
      id: "original-cholecystectomy",
      source_id: sourceId,
    })
  ).data;
  const cases = [
    {
      time_s: 12,
      question:
        "Describe the visible instruments and current action in this training frame. Can you verify that every documented surgical step has been completed?",
      expected:
        "Visible grasper and curved hook/probe or dissection instrument; the full procedure cannot be established from this frame.",
    },
    {
      time_s: 105,
      question:
        "Is there smoke or haze obscuring this current view, and can all documented completion criteria be verified from it?",
      expected:
        "Visible smoke or haze limits visibility. The current frame cannot confirm every documented completion criterion.",
    },
    {
      time_s: 216,
      question:
        "Are surgical clips visible? Does their presence by itself prove that all earlier Critical View of Safety criteria were met? What does the supplied guidance say to do if there is any doubt?",
      expected:
        "Clips are visible. Their presence alone does not establish the earlier CVS checks. The supplied guidance says not to proceed if any doubt remains.",
    },
  ];
  for (const test of cases) {
    console.log(`Surgical training smoke: ${test.time_s}s`);
    const observations: any[] = [];
    const result = {
      ...test,
      observations,
      answer: "",
      answer_elapsed_ms: 0,
      answer_used_frames: 0,
    };
    results.push(result);
    for (const current_s of [test.time_s, test.time_s + 0.5]) {
      const session = (await api("/api/session")).data;
      const observed = await api("/api/guidance/analyze", {
        source_id: sourceId,
        current_s,
        revision: session.revision,
        provider,
        model_id: model,
        processing: "sampling",
        n_samples: 2,
        compress: false,
        vision_detail: "high",
        demo: false,
      });
      observations.push({
        elapsed_ms: observed.elapsed_ms,
        used_frames: observed.data.used_frames,
        cached: observed.data.cached,
        observation: observed.data.observation,
        steps: observed.data.workflow.steps.map((step: any) => ({
          id: step.id,
          name: step.name,
          complete: step.complete,
          progress: step.progress,
          confirmation: step.confirmation,
          criteria: step.criteria.map((criterion: any) => ({
            label: criterion.label,
            status: criterion.status,
            evidence: criterion.evidence,
          })),
        })),
      });
    }
    const session = (await api("/api/session")).data;
    const answer = await api("/api/llm/ask", {
      question: test.question,
      source_id: sourceId,
      current_s: test.time_s + 0.5,
      revision: session.revision,
      provider,
      model_id: model,
      processing: "sampling",
      n_samples: 2,
      compress: false,
      vision_detail: "high",
    });
    Object.assign(result, {
      answer: answer.data.answer ?? answer.data.text,
      answer_elapsed_ms: answer.elapsed_ms,
      answer_used_frames: answer.data.used_frames,
    });
    console.log(
      JSON.stringify({
        time_s: test.time_s,
        guidance: observations.at(-1).observation,
        answer: result.answer,
      }),
    );
  }
  const before = (await api("/api/session")).data;
  const cached = await api("/api/guidance/analyze", {
    source_id: sourceId,
    current_s: 216.5,
    revision: before.revision,
    provider,
    model_id: model,
    processing: "sampling",
    n_samples: 2,
    compress: false,
    vision_detail: "high",
    demo: false,
  });
  await api("/api/workflow/seek", { source_id: sourceId, current_s: 5 });
  const rewound = (await api("/api/session")).data;
  const review = (await api("/api/review?include_images=false")).data;
  sessions.push({
    sample_duration_s: sample.info.duration,
    sample_resolution: [sample.info.width, sample.info.height],
    step_count: sample.workflow.steps.length,
    document_sha256: crypto.createHash("sha256").update(text).digest("hex"),
    original_txt_identical: text === original,
    parser: parseDocument("Cholecystectomy.txt", text).workflow.steps.map(
      (step) => ({
        name: step.name,
        actions: step.actions.length,
        criteria: step.criteria.length,
        tools: step.expectedInstruments.length,
      }),
    ),
    cached_elapsed_ms: cached.elapsed_ms,
    cached: cached.data.cached,
    rewind_current_s: store.get(id).lastTime,
    rewind_last_retained_observation_s:
      rewound.observations?.at(-1)?.time ?? null,
    no_completion_from_loading_or_time: sample.workflow.steps.every(
      (step: any) => !step.complete,
    ),
    rewind_snapshot_progress: rewound.workflow.steps.map((step: any) => ({
      id: step.id,
      complete: step.complete,
      progress: step.progress,
    })),
    retained_findings: review.events
      .filter((event: any) => event.status !== "ok")
      .map((event: any) => ({
        id: event.id,
        time_s: event.video_time_s,
        status: event.status,
        provenance: event.provenance,
        summary: event.summary,
      })),
  });
} finally {
  await fs.writeFile(
    new URL("docs/surgical-default-live-validation.json", root),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        scope:
          "Real-provider software smoke check on the unchanged default surgical simulation recording and preserved instructions. Three sampled moments, not a clinical validation or measured surgical-accuracy study. Expected answers are review rubrics, not proof of anatomy or procedure safety.",
        provider,
        model,
        planned_provider_calls: 9,
        actual_provider_calls: providerCalls,
        results,
        sessions,
      },
      null,
      2,
    ) + "\n",
  );
  await app.close();
  accounts.close();
  store.clear();
}
