import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Defaults to an offline, no-provider preflight. Live execution requires a
// deliberate flag, a loopback backend, a real provider, and a bounded call cap.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const bankPath = "evaluation/open-video-scenarios/qa/recognition-question-bank-v2.json";
const bankBytes = await fs.readFile(path.join(root, bankPath));
if (hash(bankBytes) !== "a910cf9087bff97e83434e35b3564164840979f9def5c98c2ce7f06c4ddd8a5a") throw new Error("Frozen recognition bank changed; review and explicitly version the evaluation before running.");
const bank = JSON.parse(bankBytes);
const manifestBytes = await fs.readFile(path.join(root, "evaluation/open-video-scenarios/manifest.json"));
if (hash(manifestBytes) !== "bef1e54f64b83a5b7423c711e77f1acefb83b050ecbb14408d50cfa48dd127c1") throw new Error("Source manifest changed; re-review licensed source identity.");
const manifest = JSON.parse(manifestBytes);
const domains = ["construction", "manufacturing", "surgery", "dance", "sports"];
const cases = [];
for (const [index, source] of manifest.scenarios.entries()) {
  const clipPath = path.join(root, "sample-videos", source.filename), bytes = await fs.readFile(clipPath);
  if (bytes.length !== source.bytes || hash(bytes) !== source.sha256) throw new Error(`Source checksum failed: ${source.filename}`);
  const anchor = bank.cases.find(item => item.scenario_id === source.id && item.channel === "stage");
  if (!anchor) throw new Error(`No frozen anchor for ${source.id}`);
  const start = Math.max(0, Math.min(source.duration_s - 12, anchor.timestamp_s - 6));
  cases.push({ domain: domains[index], source, clipPath, start_s: start, duration_s: 12, anchor });
}
const result = {
  schema_version: 1, mode: args.includes("--run-live") ? "live" : "offline-preflight", generated_at: new Date().toISOString(),
  bank: { file: bankPath, sha256: hash(bankBytes) },
  scope: "Five licensed 12-second excerpts. Anchor banks are stage-recognition checks, not exhaustive whole-video/count ground truth. No clinical, building, manufacturing or dance quality certification.",
  meeting: "No licensed real meeting/transcript ground truth is present; meeting semantics are tested only with visibly simulated browser fixtures.",
  cases: cases.map(({ domain, source, start_s, duration_s, anchor }) => ({ domain, source_id: source.id, source_sha256: source.sha256, source_url: source.source_url, author: source.author, license: source.license, license_url: source.license_url, start_s, duration_s, anchor_case: anchor.id, original_anchor_s: anchor.timestamp_s, results: null })),
  real_provider_calls: 0,
};
const destination = option("--out", path.join(os.tmpdir(), "cueveris-video-summary-evaluation.json"));
if (args.includes("--run-live")) {
  const base = new URL(option("--base", "http://127.0.0.1:8101"));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:" || base.username || base.password) throw new Error("Live evaluation is restricted to an explicitly configured loopback HTTP backend without URL credentials.");
  const provider = option("--provider"), model = option("--model");
  const cap = Number(option("--max-model-calls", "40"));
  if (!provider || !model || !args.includes("--max-model-calls") || !Number.isInteger(cap) || cap < 30 || cap > 40) throw new Error("Specify --provider, --model and a 30–40 --max-model-calls cap explicitly.");
  const health = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(20000), redirect: "error" }).then(response => response.json());
  if (health.mock || !health.providers?.[provider]) throw new Error("The loopback backend must expose the selected real configured provider; simulated results are not a live evaluation.");
  const owned = await fs.mkdtemp(path.join(os.tmpdir(), "cueveris-recap-eval-"));
  try {
    const ready = [];
    for (const [index, item] of cases.entries()) {
      const excerpt = path.join(owned, `${item.domain}-12s.mp4`);
      execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(item.start_s), "-i", item.clipPath, "-t", "12", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-y", excerpt], { timeout: 60000 });
      const session = crypto.randomUUID(), sourceId = crypto.randomUUID();
      const headers = { "X-Guidance-Session": session };
      const json = async (route, init = {}) => {
        const response = await fetch(new URL(route, base), { ...init, signal: AbortSignal.timeout(route.includes("upload") ? 60000 : 20000), redirect: "error", headers: { ...headers, ...init.headers } });
        const body = await response.json(); if (!response.ok || body.ok === false) throw new Error(body.error || `Evaluation route failed: ${response.status}`); return body;
      };
      await json("/api/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: sourceId, kind: "video", name: `Licensed evaluation excerpt: ${item.source.name}` }) });
      const reference = new FormData(); reference.append("file", new Blob([await fs.readFile(path.join(root, "evaluation/open-video-scenarios", item.source.guidance_file))], { type: "text/plain" }), item.source.guidance);
      await json("/api/reference/upload", { method: "POST", body: reference });
      const video = new FormData(); video.append("source_id", sourceId); video.append("file", new Blob([await fs.readFile(excerpt)], { type: "video/mp4" }), path.basename(excerpt));
      await json("/api/video/upload", { method: "POST", body: video });
      const { plan } = await json("/api/video-summary/plan?mode=balanced");
      ready.push({ index, json, plan });
    }
    // Reserve two attempts for every estimated call before spending anything.
    // Include the optional-audio estimate even though audio is disabled here.
    if (ready.reduce((total, entry) => total + 2 * entry.plan.estimated_model_calls, 0) > cap) throw new Error("The actual backend preflight, including retry reserve, exceeds the frozen evaluation call cap; no job was started.");
    for (const entry of ready) {
      const startedAt = performance.now();
      const { job: submitted } = await entry.json("/api/video-summary/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_id: entry.plan.source_id, reference_key: entry.plan.reference_key, mode: "balanced", provider, model_id: model, include_audio: false }) });
      let job = submitted;
      try {
        while (["queued", "planning", "analyzing", "synthesizing"].includes(job.status)) {
          if (performance.now() - startedAt > 180000) throw new Error("Bounded evaluation job timed out");
          await new Promise(resolve => setTimeout(resolve, 1500)); ({ job } = await entry.json(`/api/video-summary/jobs/${submitted.id}`));
        }
      } catch (error) { await entry.json(`/api/video-summary/jobs/${submitted.id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); throw error; }
      if (job.provenance.simulated) throw new Error("Refusing to label a simulated result as live evaluation");
      result.real_provider_calls += job.provenance.model_calls;
      result.cases[entry.index].results = { job, latency_ms: Math.round(performance.now() - startedAt), manual_review: { status: "required", notes: "Review citations, unsupported assertions, cuts and source-relative timestamps against the frozen anchor. No accuracy score is fabricated by this script." } };
      if (result.real_provider_calls > cap) throw new Error("Actual provider calls exceeded the bounded cap; no additional jobs will be started.");
      await fs.writeFile(destination, JSON.stringify(result, null, 2));
    }
  } finally { await fs.rm(owned, { recursive: true, force: true }); }
}
await fs.writeFile(destination, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ mode: result.mode, cases: result.cases.length, real_provider_calls: result.real_provider_calls, output: destination }));
