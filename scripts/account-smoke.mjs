import fs from "node:fs/promises";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Running local build: no provider calls and no messages sent outside this app.
const base = process.argv[2] || "http://localhost:8101";
const origin = new URL(base).origin;
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Use a local app URL for this smoke test.");
const session = crypto.randomUUID(),
  source = crypto.randomUUID();
const email = `smoke-${crypto.randomUUID()}@example.com`,
  password = crypto.randomUUID() + "-test";
const assets = fileURLToPath(
  new URL("../evaluation/assets/parts-sorting.mp4", import.meta.url),
);
let cookie = "",
  registered = false;
let result;
async function call(
  route,
  body,
  method = body ? "POST" : "GET",
  expectedStatus,
) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      Origin: origin,
      "X-Guidance-Session": session,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  for (const value of response.headers.getSetCookie())
    if (value.startsWith("process-guide-account="))
      cookie = value.split(";")[0];
  if (expectedStatus ? response.status !== expectedStatus : !response.ok)
    throw new Error(
      `${method} ${route}: ${response.status} ${await response.text()}`,
    );
  return response;
}
const json = async (route, body, method) =>
  (await call(route, body, method)).json();
const guard = (review) => ({
  source_id: review.source_id,
  reference_key: review.reference_key,
  review_version: review.review_version,
});
try {
  await json("/api/source", {
    source_id: source,
    kind: "video",
    name: "Smoke test assembly",
  });
  const form = new FormData();
  form.set("source_id", source);
  form.set(
    "file",
    new Blob([await fs.readFile(assets)], { type: "video/mp4" }),
    "parts-sorting.mp4",
  );
  await json("/api/video/upload", form);
  await json("/api/reference/load-sample", { filename: "Coffee_Brewing.txt" });
  let review = await json("/api/review");
  review = await json(
    "/api/review/readiness",
    {
      ...guard(review),
      job: { work_order: "SMOKE", operator: "Test operator" },
      checks: review.checks
        .slice(0, 1)
        .map((check) => ({ id: check.id, checked: true })),
    },
    "PUT",
  );
  const image = execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-ss",
      "6",
      "-i",
      assets,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  review = await json("/api/review/bookmarks", {
    ...guard(review),
    current_s: 6,
    frame_b64: image.toString("base64"),
    note: "Production evidence smoke test",
  });
  const started = performance.now();
  const pdf = Buffer.from(
    await (await call("/api/review/report.pdf")).arrayBuffer(),
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const pdfMs = Math.round(performance.now() - started);
  const html = await (await call("/api/review/report.html")).text();
  assert.ok(html.includes("Coffee_Brewing.txt"));
  assert.ok(html.includes("Production evidence smoke test"));
  await json("/api/account/register", {
    name: "Temporary smoke account",
    email,
    password,
  });
  registered = true;
  const saved = await json("/api/account/training/save", {
    ...guard(review),
    include_evidence_images: true,
  });
  await json("/api/account/training/save", {
    ...guard(review),
    include_evidence_images: true,
  });
  const training = await json("/api/account/training");
  assert.equal(training.history.length, 1);
  assert.equal(training.history[0].includes_evidence_images, true);
  const stored = await json(`/api/account/training/${saved.id}`);
  assert.ok(stored.report.handoff.evidence[0].thumbnail_b64);
  const savedPdf = Buffer.from(
    await (
      await call(`/api/account/training/${saved.id}/report.pdf`)
    ).arrayBuffer(),
  );
  assert.equal(savedPdf.subarray(0, 5).toString(), "%PDF-");
  const unicode = "工序检查 / مرحلة";
  review = await json(
    "/api/review/readiness",
    { ...guard(review), job: { work_order: unicode } },
    "PUT",
  );
  const rejected = await (
    await call("/api/review/report.pdf", undefined, "GET", 422)
  ).json();
  assert.match(rejected.error, /offline HTML/);
  assert.ok(
    (await (await call("/api/review/report.html")).text()).includes(unicode),
  );
  await json("/api/account/training/save", {
    ...guard(review),
    include_evidence_images: true,
  });
  const savedRejected = await (
    await call(
      `/api/account/training/${saved.id}/report.pdf`,
      undefined,
      "GET",
      422,
    )
  ).json();
  assert.match(savedRejected.error, /offline HTML/);
  assert.ok(
    (
      await (await call(`/api/account/training/${saved.id}/report.html`)).text()
    ).includes(unicode),
  );
  assert.equal((await json("/api/account/training")).history.length, 1);
  await json("/api/account/logout", {});
  assert.equal((await json("/api/account/me")).user, null);
  await json("/api/account/login", { email, password });
  assert.ok((await json("/api/account/me")).user);
  result = {
    base,
    passed: true,
    pdf_bytes: pdf.length,
    pdf_ms: pdfMs,
    saved_pdf_bytes: savedPdf.length,
    unique_saved_runs: training.history.length,
    unsupported_pdf_characters_rejected: true,
    unicode_html_preserved: true,
    provider_calls: 0,
    temporary_account_removed: true,
  };
} finally {
  if (registered) {
    await json("/api/account/login", { email, password });
    await json(
      "/api/account/me",
      { password, confirmation: "DELETE" },
      "DELETE",
    );
  }
  await json("/api/source", {
    source_id: crypto.randomUUID(),
    kind: "camera",
    name: "Smoke cleanup",
  });
}
console.log(JSON.stringify(result));
