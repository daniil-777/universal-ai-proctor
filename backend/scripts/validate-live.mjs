// Opt-in real-provider check. Sends only generated, non-sensitive test images.
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
const base = process.env.GUIDANCE_TEST_URL || "http://127.0.0.1:8101";
const session = crypto.randomUUID();
async function api(route, body, method = body ? "POST" : "GET") {
  const start = performance.now();
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-guidance-session": session,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(50000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${route}: ${response.status} ${result.error}`);
  return { result, elapsed_ms: Math.round(performance.now() - start) };
}
const health = (await api("/api/health")).result;
if (health.mock || !health.providers.openai)
  throw new Error(
    "Configure a real OpenAI provider before running this opt-in check.",
  );
await api("/api/source", {
  source_id: "live-validation",
  kind: "video",
  name: "Synthetic label accuracy check",
});
const document = (
  await api(
    "/api/reference/document",
    {
      text: "Step 1: Read the label\nActions: Inspect the package label.\nCriteria: Printed BOX A label visibly readable.\nStep 2: Seal the package\nActions: Seal the package with tape.\nCriteria: Package visibly sealed with tape.",
    },
    "PUT",
  )
).result;
async function frame(offset = 0) {
  return (
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#e7edf2"/><rect x="${180 + offset}" y="150" width="560" height="280" fill="#b78855" stroke="#513b27" stroke-width="8"/><rect x="${310 + offset}" y="220" width="300" height="90" fill="white"/><text x="${333 + offset}" y="282" font-family="Arial" font-size="54" fill="black">BOX A</text></svg>`,
      ),
    )
      .jpeg({ quality: 90 })
      .toBuffer()
  ).toString("base64");
}
const body = {
  provider: "openai",
  model_id: "gpt-4o-mini",
  source_id: "live-validation",
  revision: document.revision,
  current_s: 1,
  frames_b64: [await frame()],
  frame_times_s: [1],
  vision_detail: "high",
  compress: false,
};
const requests = [
  body,
  body,
  { ...body, current_s: 2, frames_b64: [await frame(12)], frame_times_s: [2] },
];
const observations = [];
for (const request of requests) {
  const { result, elapsed_ms } = await api("/api/guidance/analyze", request);
  if (
    result.workflow.steps[1].complete ||
    result.workflow.steps[1].progress !== 0
  )
    throw new Error("Unseen sealing action received progress.");
  observations.push({
    elapsed_ms,
    cached: !!result.cached,
    used_frames: result.used_frames,
    image_quality: result.image_quality,
    vision_detail: result.vision_detail,
    observation: result.observation,
    steps: result.workflow.steps.map((s) => ({
      id: s.id,
      progress: s.progress,
      complete: s.complete,
    })),
  });
}
if (!observations[1].cached)
  throw new Error("Identical observation was not cached.");
const blank = (
  await sharp({
    create: { width: 640, height: 360, channels: 3, background: "black" },
  })
    .jpeg()
    .toBuffer()
).toString("base64");
const { result, elapsed_ms } = await api("/api/guidance/analyze", {
  ...body,
  current_s: 3,
  frames_b64: [blank],
  frame_times_s: [3],
});
if (result.image_quality !== "unusable" || result.workflow.steps[1].complete)
  throw new Error("Blank frame quality gate failed.");
const record = {
  date: new Date().toISOString(),
  description:
    "Synthetic label recognition; unseen action must remain unknown. Software smoke check, not a process/clinical accuracy study.",
  observations,
  blank: {
    elapsed_ms,
    image_quality: result.image_quality,
    observation: result.observation,
  },
};
fs.writeFileSync(
  new URL("../../docs/critical-live-validation.json", import.meta.url),
  JSON.stringify(record, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      checks: observations.map((o) => ({
        elapsed_ms: o.elapsed_ms,
        cached: o.cached,
        steps: o.steps,
      })),
      blank: record.blank,
    },
    null,
    2,
  ),
);
