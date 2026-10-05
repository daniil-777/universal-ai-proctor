import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  probeVideo,
  extractFramesByIndices,
} from "../backend/dist/pipeline/frames.js";
import { scoreAnswer, summarize } from "./scoring.mjs";
const require = createRequire(
  new URL("../backend/package.json", import.meta.url),
);
const sharp = require("sharp");
const root = fileURLToPath(new URL("./", import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(path.join(root, "dataset.json"), "utf8"),
);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const input = option("--answers");
if (!args.includes("--live") && !input)
  throw new Error(
    "Use --live for a real provider run, or --answers <json> to score saved replies without AI calls.",
  );
const base = option("--url", "http://127.0.0.1:8101");
const provider = option("--provider", "openai"),
  model = option("--model", "gpt-4o-mini");
const only = option("--only", "");
const selected = dataset.cases.filter((test) => test.id.includes(only));
if (!selected.length) throw new Error("No cases match --only.");
const resultsDirectory = path.join(root, "results");
fs.mkdirSync(resultsDirectory, { recursive: true });
const saved = input
  ? JSON.parse(fs.readFileSync(path.resolve(input), "utf8"))
  : null;
const savedRows = Array.isArray(saved) ? saved : saved?.results;
if (saved && !Array.isArray(savedRows))
  throw new Error(
    "Answer input must be an array or a report with a results array.",
  );
async function api(id, route, body, method = "POST") {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", "x-guidance-session": id },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${(await response.json()).error}`);
  return response;
}
const frameCache = new Map();
const videoInfo = new Map();
async function framesFor(test) {
  const video = path.join(root, "assets", test.video);
  if (!videoInfo.has(video)) videoInfo.set(video, await probeVideo(video));
  const fps = videoInfo.get(video).fps;
  const currentIndex = Math.floor(test.time_s * fps);
  const indices = [
    Math.max(0, currentIndex - Math.round(fps)),
    currentIndex,
  ].filter((index, i, array) => i === 0 || index !== array[0]);
  const buffers = [];
  for (const index of indices) {
    const key = `${video}:${index}`;
    if (!frameCache.has(key))
      frameCache.set(key, (await extractFramesByIndices(video, [index]))[0]);
    const frame = frameCache.get(key);
    if (!frame) throw new Error(`Missing video frame ${key}`);
    buffers.push(frame);
  }
  const latest = path.join(
    root,
    "assets",
    `${test.video.replace(".mp4", "")}-${currentIndex}.jpg`,
  );
  if (!fs.existsSync(latest))
    await sharp(buffers.at(-1))
      .resize({ width: 480, height: 480, fit: "inside" })
      .jpeg()
      .toFile(latest);
  return {
    frames_b64: buffers.map((frame) => frame.toString("base64")),
    frame_times_s: indices.map((index) => index / fps),
    thumbnail: `/evaluation/assets/${path.basename(latest)}`,
  };
}
async function live(test) {
  const id = crypto.randomUUID();
  await api(id, "/api/source", {
    source_id: id,
    kind: "video",
    name: test.video,
  });
  const document = await (
    await api(
      id,
      "/api/reference/document",
      {
        text: test.reference
          ? fs.readFileSync(path.join(root, "assets", test.reference), "utf8")
          : "",
      },
      "PUT",
    )
  ).json();
  const frames = await framesFor(test);
  const body = {
    provider,
    model_id: model,
    source_id: id,
    revision: document.revision,
    current_s: test.time_s,
    ...frames,
    compress: false,
    vision_detail: "high",
  };
  const started = performance.now();
  if (test.channel === "Guardian") {
    const value = await (await api(id, "/api/guidance/analyze", body)).json();
    return {
      answer: [value.observation.summary, value.observation.concern]
        .filter(Boolean)
        .join("\n"),
      latency_ms: Math.round(performance.now() - started),
      thumbnail: frames.thumbnail,
      observation: value.observation,
      workflow: value.workflow,
      current_step: value.current_stage_id,
      image_quality: value.image_quality,
      status: value.status,
    };
  }
  const response = await api(id, "/api/llm/ask/stream", {
    ...body,
    question: test.question,
    voice: true,
  });
  let answer = "",
    firstToken = null,
    buffer = "",
    done = false;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const line = block.split("\n").find((line) => line.startsWith("data:"));
      if (!line) continue;
      const event = JSON.parse(line.slice(5));
      if (event.error) throw new Error(event.error);
      if (event.delta) {
        if (firstToken === null)
          firstToken = Math.round(performance.now() - started);
        answer += event.delta;
      }
      if (event.done) done = true;
    }
  }
  if (!done || !answer.trim())
    throw new Error("Listener stream ended without a complete answer.");
  return {
    answer,
    latency_ms: Math.round(performance.now() - started),
    first_token_ms: firstToken,
    thumbnail: frames.thumbnail,
  };
}
const rows = [];
for (const test of selected) {
  const row = {
    id: test.id,
    channel: test.channel,
    video: test.video,
    time_s: test.time_s,
    reference: test.reference,
    question: test.question || "Describe the current visible process.",
    utterance: test.utterance,
    expected_answer: test.expected_answer,
    required_fact_count: test.required_facts.length,
    recorded_at: new Date().toISOString(),
  };
  try {
    const value = input
      ? savedRows.find((row) => row.id === test.id)
      : await live(test);
    if (!value) throw new Error("No saved reply for this case.");
    if (test.channel === "Guardian" && value.observation)
      value.answer = [value.observation.summary, value.observation.concern]
        .filter(Boolean)
        .join("\n");
    Object.assign(row, value, {
      id: test.id,
      channel: test.channel,
      expected_answer: test.expected_answer,
      required_fact_count: test.required_facts.length,
    });
    row.score = scoreAnswer(test, row.answer);
    row.checks = {};
    if (test.channel === "Guardian") {
      row.checks.single_observation_does_not_complete = (
        row.workflow?.steps || []
      ).every((step) => !step.complete);
      if (test.expected_step)
        row.checks.step_selection = row.current_step === test.expected_step;
      if (test.expected_quality)
        row.checks.image_quality = row.image_quality === test.expected_quality;
      if (test.expected_status)
        row.checks.status = test.expected_status.includes(row.status);
      if (test.unrelated_progress_must_be_zero)
        row.checks.unrelated_progress = (row.workflow?.steps || []).every(
          (step) => step.progress === 0,
        );
      if (test.expect_discovery)
        row.checks.provisional_workflow =
          row.workflow?.source === "inferred" && row.workflow.steps.length > 0;
    }
  } catch (error) {
    row.error = String(error.message || error);
    row.score = scoreAnswer(test, "");
  }
  rows.push(row);
  console.log(
    `${rows.length}/${selected.length} ${row.id}: ${row.error ? "ERROR" : row.score.pass && Object.values(row.checks || {}).every(Boolean) ? "PASS" : "REVIEW"} ${row.latency_ms || 0}ms`,
  );
}
const latestFile = path.join(resultsDirectory, "latest.json");
let combined = rows;
if (only && fs.existsSync(latestFile)) {
  const prior = JSON.parse(fs.readFileSync(latestFile, "utf8"));
  if (
    prior.dataset_version === dataset.version &&
    prior.provider === provider &&
    prior.model === model
  )
    combined = dataset.cases
      .map(
        (test) =>
          rows.find((row) => row.id === test.id) ||
          prior.results.find((row) => row.id === test.id),
      )
      .filter(Boolean);
}
// Re-score every retained answer with the current published rubric.
combined = combined.map((row) => ({
  ...row,
  score: scoreAnswer(
    dataset.cases.find((test) => test.id === row.id),
    row.answer || "",
  ),
}));
const report = {
  dataset_version: dataset.version,
  generated_at: new Date().toISOString(),
  provider,
  model,
  run_kind: input ? "re-scored saved provider replies" : "real provider",
  cases_in_dataset: dataset.cases.length,
  cases_evaluated: combined.length,
  cases_this_execution: rows.length,
  recognition_word_error_rate: null,
  limitations:
    "Targeted regex fact rubrics can miss paraphrases and unlisted claims. Reference overlap is wording similarity, not correctness. Listener replies use prepared recognized transcripts; physical microphone/STT accuracy and clinical accuracy are not measured.",
  metrics: summarize(combined),
  results: combined,
};
// Keep the latest complete run per model, never the best answer per case.
const modelRuns = new Map([[model, report]]);
for (const file of fs
  .readdirSync(resultsDirectory)
  .filter((file) => file.endsWith(".json") && file !== "latest.json")) {
  const prior = JSON.parse(
    fs.readFileSync(path.join(resultsDirectory, file), "utf8"),
  );
  if (
    prior.dataset_version !== dataset.version ||
    prior.cases_evaluated !== dataset.cases.length ||
    prior.provider !== provider
  )
    continue;
  const current = modelRuns.get(prior.model);
  if (!current || prior.generated_at > current.generated_at)
    modelRuns.set(prior.model, prior);
}
report.model_comparison = [...modelRuns.values()].map((run) => ({
  model: run.model,
  recorded_at: run.generated_at,
  metrics: run.metrics,
  cases_evaluated: run.cases_evaluated,
}));
const stamp = report.generated_at.replace(/[:.]/g, "-");
fs.writeFileSync(
  path.join(resultsDirectory, `${stamp}.json`),
  JSON.stringify(report, null, 2) + "\n",
);
fs.writeFileSync(latestFile, JSON.stringify(report, null, 2) + "\n");
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const percent = (value) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
const summary = Object.entries(report.metrics)
  .map(
    ([channel, m]) =>
      `<section class="card"><h2>${escape(channel)}</h2><div class="stats"><div><strong>${percent(m.fact_recall)}</strong>Rubric fact recall</div><div><strong>${percent(m.contradiction_free_rate)}</strong>No rubric contradictions flagged</div><div><strong>${m.passed}/${m.cases}</strong>All checks passed</div><div><strong>${m.latency_p50_ms ?? "—"} ms</strong>Median latency</div><div><strong>${m.latency_p95_ms ?? "—"} ms</strong>95th percentile latency</div><div><strong>${channel === "Guardian" ? percent(m.step_selection_agreement) : (m.first_token_p50_ms ?? "—") + " ms"}</strong>${channel === "Guardian" ? "Step selection agreement" : "Median first token"}</div></div></section>`,
  )
  .join("");
const detail = combined
  .map(
    (row) =>
      `<article class="card case"><div class="case-title"><h3>${escape(row.id)}</h3><span class="pill ${row.error || !row.score.pass || Object.values(row.checks || {}).some((ok) => !ok) ? "review" : "pass"}">${row.error ? "Error" : row.score.pass && Object.values(row.checks || {}).every(Boolean) ? "Pass" : "Needs review"}</span></div><p class="meta">${escape(row.video)} · ${row.time_s}s · ${escape(row.channel)} · ${row.latency_ms ?? "—"} ms</p>${row.thumbnail ? `<img src="${escape(row.thumbnail)}" alt="Annotated current video frame" loading="lazy">` : ""}<p><b>Question:</b> ${escape(row.question)}</p>${row.utterance ? `<p><b>Prepared spoken input:</b> ${escape(row.utterance)}</p>` : ""}<div class="answers"><div><h4>Expected answer</h4><p>${escape(row.expected_answer)}</p></div><div><h4>Actual answer</h4><p>${escape(row.answer || row.error)}</p></div></div><p class="meta">Missed facts: ${escape(row.score.missed_facts.join(", ") || "none")} · Contradictions: ${escape(row.score.contradictions.join(", ") || "none")} · Protocol checks: ${escape(
        Object.entries(row.checks || {})
          .map(([key, ok]) => key + ": " + (ok ? "pass" : "fail"))
          .join(" · "),
      )} · Reference wording overlap: ${percent(row.score.reference_overlap)}</p></article>`,
  )
  .join("");
const modelComparison =
  report.model_comparison.length > 1
    ? `<section class="card"><h2>Same-dataset model comparison</h2><p class="meta">Latest complete run per model. Archived replies use the same current rubric; no best-of-case selection.</p><div style="overflow-x:auto"><table style="width:100%;text-align:left;font-size:13px"><thead><tr><th>Model / channel</th><th>Passed</th><th>Fact recall</th><th>Median</th></tr></thead><tbody>${report.model_comparison.flatMap((run) => Object.entries(run.metrics).map(([channel, m]) => `<tr><td>${escape(run.model)} / ${escape(channel)}</td><td>${m.passed}/${m.cases}</td><td>${percent(m.fact_recall)}</td><td>${m.latency_p50_ms} ms</td></tr>`)).join("")}</tbody></table></div></section>`
    : "";
const videoLibrary = dataset.videos
  .map((video) => {
    const reference = dataset.cases.find(
      (test) =>
        test.video === video &&
        test.reference &&
        test.reference !== "Coffee_Brewing.txt",
    )?.reference;
    return `<section class="card"><h3>${escape(video)}</h3><video controls preload="metadata" style="width:100%;max-height:300px;border-radius:10px" src="/evaluation/assets/${escape(video)}"></video><p><a href="/evaluation/assets/${escape(video)}" download>Download video</a>${reference ? ` · <a href="/evaluation/assets/${escape(reference)}" download>Download matching guidance</a>` : ""}</p></section>`;
  })
  .join("");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Process Guide · Answer quality benchmark</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f7f9;color:#163040;font:15px/1.6 system-ui,sans-serif}header{background:#0b1c26;color:white;padding:28px max(20px,calc((100vw - 1120px)/2))}main{max-width:1160px;margin:auto;padding:24px 20px}h1{font-size:28px;margin:0}h2,h3,h4{margin:0 0 10px}h3{font-size:16px;overflow-wrap:anywhere}h4{font-size:13px;color:#0a7d91}a{color:#087d92}header a{color:#a1e1e8}.card{background:white;border:1px solid #d5e1e7;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 3px 15px #143d4d05}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.stats strong{display:block;font-size:28px;color:#0a7d91}.stats div,.meta{font-size:12px;color:#5d7480}.case-title{display:flex;gap:16px;justify-content:space-between;align-items:start}.pill{font-size:12px;border-radius:30px;padding:3px 10px;white-space:nowrap}.pass{background:#e2f4e9;color:#177346}.review{background:#fff0d7;color:#9b6208}.case img{max-width:260px;max-height:200px;border-radius:8px;float:right;margin:0 0 12px 20px}.answers{display:grid;grid-template-columns:1fr 1fr;gap:20px;clear:both}.answers>div{background:#f5f8fa;border-radius:10px;padding:14px}.answers p{margin:0}.case{overflow:hidden}.warning{border-left:4px solid #d18a10;padding-left:14px}@media(max-width:650px){.stats{grid-template-columns:1fr 1fr}.answers{grid-template-columns:1fr}.case img{float:none;margin:0;max-width:100%}.case-title{flex-wrap:wrap}.card{padding:14px}h1{font-size:24px}}@media print{header{background:white;color:black}.card{box-shadow:none;break-inside:avoid}}</style><header><a href="/">Process Guide</a><h1>Answer quality benchmark</h1><p>Prepared answers compared with Guardian observations and streamed listener replies.</p></header><main><p>${escape(report.model)} · ${report.cases_evaluated} annotated cases · ${escape(report.generated_at)}</p><p class="warning">${escape(report.limitations)} Source videos, timestamps, expected answers and rubrics are included in the evaluation folder. Raw answers are retained below for review.</p>${summary}${modelComparison}<details class="card"><summary>Test videos and matching guidance files</summary>${videoLibrary}</details><p><a href="/api/evaluation/latest">Download the full JSON results</a></p>${detail}</main></html>`;
fs.writeFileSync(path.join(resultsDirectory, "latest.html"), html);
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const csv = [
  [
    "case",
    "channel",
    "video",
    "time_s",
    "expected_answer",
    "actual_answer",
    "fact_recall",
    "contradictions",
    "all_checks_pass",
    "latency_ms",
    "first_token_ms",
  ],
  ...combined.map((row) => [
    row.id,
    row.channel,
    row.video,
    row.time_s,
    row.expected_answer,
    row.answer || row.error,
    row.score.fact_recall,
    row.score.contradictions.join("|"),
    row.score.pass && Object.values(row.checks || {}).every(Boolean),
    row.latency_ms,
    row.first_token_ms,
  ]),
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
fs.writeFileSync(path.join(resultsDirectory, "latest.csv"), csv + "\n");
console.log(JSON.stringify(report.metrics, null, 2));
console.log("Report: http://localhost:8101/evaluation");
if (combined.some((row) => row.error)) process.exitCode = 1;
