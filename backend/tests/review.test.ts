import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { appendReviewEvent, captureObservationReview, ensureReview, makeReviewThumbnail, referenceKey, REVIEW_LIMITS, reviewSnapshot, structuredHandoff, syncReview } from "../src/domain/review.js";
import { ObservationSchema, parseDocument } from "../src/domain/guidance.js";
import { FrameBody, GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete, fixtureDocument, texturedFrame } from "./fixtures.js";
import * as reportRenderer from "../src/media/analysisReport.js";
import * as framePipeline from "../src/pipeline/frames.js";

const store = new SessionStore();
const app = await createApp({ store, engine: new GuidanceEngine(fixtureComplete) });
let frame: string;
beforeAll(async () => { frame = await texturedFrame(); });
afterAll(async () => { await app.close(); });
async function request(id: string, method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: object) {
  return app.inject({ method, url, headers: { "x-guidance-session": id }, payload });
}
async function fresh() {
  const id = crypto.randomUUID();
  await request(id, "POST", "/api/source", { source_id: "test-video", kind: "video", name: "Inspection video" });
  await request(id, "PUT", "/api/reference/document", { text: fixtureDocument.replace("Actions: Place", "Tools: Inspection tool\nActions: Place") });
  return { id, s: store.get(id) };
}
function guard(id: string) {
  const snapshot = reviewSnapshot(store.get(id));
  return { source_id: snapshot.source_id, reference_key: snapshot.reference_key, review_version: snapshot.review_version };
}
const observe = (id: string, time = 10) => request(id, "POST", "/api/guidance/analyze", { source_id: "test-video", current_s: time, frames_b64: [frame], frame_times_s: [time] });

describe("industry review transactions", () => {
  it("derives distinct preparation suggestions from document tools and principles", async () => {
    const { id } = await fresh();
    const review = (await request(id, "GET", "/api/review")).json();
    expect(review.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Inspection tool", kind: "tool", checked: false }),
      expect.objectContaining({ label: "Always check the work area.", kind: "principle", checked: false }),
    ]));
    expect(review.notice).toContain("not safety certification");
  });
  it("retains every supplied principle when a long workflow exceeds the preparation-check cap", async () => {
    const { s } = await fresh();
    s.workflow.steps[0].expectedInstruments = Array.from({ length: 120 }, (_, index) => `Tool ${index}`);
    s.workflow.principles = Array.from({ length: 40 }, (_, index) => `Document principle ${index}`);
    const review = reviewSnapshot(s);
    expect(review.checks).toHaveLength(80);
    expect(review.checks.filter(check => check.kind === "principle")).toHaveLength(40);
    expect(review.checks[0].kind).toBe("tool");
  });
  it("supports partial job metadata and explicitly records who checked preparation", async () => {
    const { id, s } = await fresh();
    const check = reviewSnapshot(s).checks[0];
    await request(id, "PUT", "/api/review/readiness", { ...guard(id), job: { operator: "Alex", work_order: "WO-17" } });
    const saved = await request(id, "PUT", "/api/review/readiness", { ...guard(id), job: { asset: "Pump-2" }, checks: [{ id: check.id, checked: true }] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().job).toEqual({ operator: "Alex", work_order: "WO-17", asset: "Pump-2" });
    expect(saved.json().checks[0]).toMatchObject({ checked: true, checked_by: "Alex", checked_at: expect.any(Number) });
    expect(s.workflow.steps.every(step => !step.complete)).toBe(true);
  });
  it("rejects unknown and duplicate checks atomically without changing job metadata", async () => {
    const { id, s } = await fresh();
    const before = structuredHandoff(s);
    const failed = await request(id, "PUT", "/api/review/readiness", { ...guard(id), job: { work_order: "wrong" }, checks: [{ id: "unknown", checked: true }] });
    expect(failed.statusCode).toBe(400);
    expect(reviewSnapshot(s).job).toEqual(before.job);
    const check = reviewSnapshot(s).checks[0];
    expect((await request(id, "PUT", "/api/review/readiness", { ...guard(id), checks: [{ id: check.id, checked: true }, { id: check.id, checked: false }] })).statusCode).toBe(400);
  });
  it("rejects lost-update mutations while allowing a retry with the latest version", async () => {
    const { id } = await fresh();
    const scope = guard(id);
    const responses = await Promise.all([
      request(id, "PUT", "/api/review/readiness", { ...scope, job: { work_order: "A" } }),
      request(id, "PUT", "/api/review/readiness", { ...scope, job: { work_order: "B" } }),
    ]);
    expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect((await request(id, "PUT", "/api/review/readiness", { ...guard(id), job: { asset: "Latest" } })).statusCode).toBe(200);
  });
  it("captures immutable timed AI evidence and deduplicates a repeated unresolved concern", async () => {
    const { id } = await fresh();
    expect((await observe(id, 10)).statusCode).toBe(200);
    let review = (await request(id, "GET", "/api/review")).json();
    expect(review.events[0]).toMatchObject({ provenance: "ai", kind: "observation", video_time_s: 10, source_id: "test-video", status: "watch", old_reference: false });
    expect(review.events[0].thumbnail_b64).toMatch(/^data:image\/jpeg;base64,/);
    expect(review.exceptions).toHaveLength(1);
    await observe(id, 11);
    review = (await request(id, "GET", "/api/review")).json();
    expect(review.events).toHaveLength(2);
    expect(review.exceptions).toHaveLength(1);
    expect(review.events[1].thumbnail_b64).toBeUndefined();
  });
  it("serves lightweight metadata without losing thumbnails in the stored evidence", async () => {
    const { id, s } = await fresh();
    await observe(id);
    const metadata = await request(id, "GET", "/api/review?include_images=false");
    expect(metadata.json().events[0]).toMatchObject({ thumbnail_available: true, provenance: "ai" });
    expect(metadata.json().events[0].thumbnail_b64).toBeUndefined();
    expect(reviewSnapshot(s).events[0].thumbnail_b64).toMatch(/^data:image\/jpeg;base64,/);
    expect((await request(id, "GET", "/api/review?include_images=true")).json().events[0].thumbnail_b64).toBeTruthy();
    expect((await request(id, "GET", "/api/review?include_images=maybe")).statusCode).toBe(400);
  });
  it("keeps future evidence and operator preparation across backward seek and confirmation", async () => {
    const { id, s } = await fresh();
    const check = reviewSnapshot(s).checks[0];
    await request(id, "PUT", "/api/review/readiness", { ...guard(id), checks: [{ id: check.id, checked: true }] });
    await observe(id, 10);
    const key = referenceKey(s);
    await request(id, "POST", "/api/workflow/seek", { source_id: "test-video", current_s: 2 });
    expect(s.observations).toHaveLength(0);
    expect(reviewSnapshot(s).events[0].video_time_s).toBe(10);
    expect(reviewSnapshot(s).checks[0].checked).toBe(true);
    await request(id, "POST", "/api/workflow/steps/S1/confirm", { complete: true, current_s: 2 });
    expect(referenceKey(s)).toBe(key);
    expect(reviewSnapshot(s).checks[0].checked).toBe(true);
  });
  it("clears preparation confirmations on actual reference change and marks retained evidence historical", async () => {
    const { id, s } = await fresh();
    const check = reviewSnapshot(s).checks[0];
    await request(id, "PUT", "/api/review/readiness", { ...guard(id), checks: [{ id: check.id, checked: true }], job: { work_order: "Keep this job" } });
    await observe(id, 10);
    const oldScope = guard(id);
    await request(id, "PUT", "/api/reference/document", { text: `${s.text}\nStep 3 — Review\nActions: Review the result.` });
    const review = reviewSnapshot(s);
    expect(review.reference_key).not.toBe(oldScope.reference_key);
    expect(review.checks.every(item => !item.checked)).toBe(true);
    expect(review.events[0].old_reference).toBe(true);
    expect(review.exceptions[0].old_reference).toBe(true);
    expect(review.job.work_order).toBe("Keep this job");
    expect((await request(id, "PUT", "/api/review/readiness", { ...oldScope, job: { asset: "Stale" } })).statusCode).toBe(409);
  });
  it("isolates sessions and clears all review data when changing media source", async () => {
    const { id, s } = await fresh();
    await observe(id);
    const oldScope = guard(id);
    expect((await request(crypto.randomUUID(), "GET", "/api/review")).json().events).toHaveLength(0);
    await request(id, "POST", "/api/source", { source_id: "camera-new", kind: "camera", name: "New camera" });
    expect(reviewSnapshot(s).events).toHaveLength(0);
    expect(reviewSnapshot(s).exceptions).toHaveLength(0);
    expect((await request(id, "POST", "/api/review/bookmarks", { ...oldScope, current_s: 0, frame_b64: frame })).statusCode).toBe(409);
  });
  it("creates a sanitized operator bookmark without changing progress or AI observations", async () => {
    const { id, s } = await fresh();
    const before = JSON.stringify(s.workflow);
    const saved = await request(id, "POST", "/api/review/bookmarks", { ...guard(id), current_s: 7.25, frame_b64: frame, note: "Check café — <script>alert(1)</script>", operator_label: "Sam" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().events[0]).toMatchObject({ kind: "bookmark", provenance: "operator", operator: "Sam", video_time_s: 7.25, summary: "Check café — <script>alert(1)</script>" });
    const jpeg = Buffer.from(saved.json().events[0].thumbnail_b64.split(",")[1], "base64");
    expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
    expect(JSON.stringify(s.workflow)).toBe(before);
    expect(s.observations).toHaveLength(0);
  });
  it("rejects invalid, non-raster and out-of-range evidence", async () => {
    const { id, s } = await fresh();
    for (const bad of ["not an image", "data:image/svg+xml;base64,PHN2Zy8+", Buffer.from("bad image").toString("base64")])
      expect((await request(id, "POST", "/api/review/bookmarks", { ...guard(id), current_s: 0, frame_b64: bad })).statusCode).toBe(400);
    s.videoInfo = { duration: 5, fps: 25, width: 128, height: 96 };
    expect((await request(id, "POST", "/api/review/bookmarks", { ...guard(id), current_s: 8, frame_b64: frame })).statusCode).toBe(400);
    expect(reviewSnapshot(s).events).toHaveLength(0);
  });
  it("records acknowledgement, required resolution note and reopening without confirming any criteria", async () => {
    const { id, s } = await fresh();
    await observe(id);
    const issue = reviewSnapshot(s).exceptions[0];
    const before = JSON.stringify(s.workflow);
    expect((await request(id, "PATCH", `/api/review/exceptions/${issue.id}`, { ...guard(id), status: "resolved", note: "  " })).statusCode).toBe(400);
    await request(id, "PATCH", `/api/review/exceptions/${issue.id}`, { ...guard(id), status: "acknowledged", operator_label: "Pat" });
    await request(id, "PATCH", `/api/review/exceptions/${issue.id}`, { ...guard(id), status: "resolved", note: "Moved the obstruction; verify next observation.", operator_label: "Pat" });
    const reopened = await request(id, "PATCH", `/api/review/exceptions/${issue.id}`, { ...guard(id), status: "open", note: "Needs another review.", operator_label: "Lee" });
    expect(reopened.json().exceptions[0].history.map((entry: { status: string }) => entry.status)).toEqual(["open", "acknowledged", "resolved", "open"]);
    expect(reopened.json().exceptions[0].history.at(-1).operator).toBe("Lee");
    expect(JSON.stringify(s.workflow)).toBe(before);
  });
  it("supports manually raised and linked exceptions and rejects missing links", async () => {
    const { id } = await fresh();
    await request(id, "POST", "/api/review/bookmarks", { ...guard(id), current_s: 1, frame_b64: frame });
    const event = reviewSnapshot(store.get(id)).events[0];
    const raised = await request(id, "POST", "/api/review/exceptions", { ...guard(id), title: "Missing part", event_id: event.id, description: "Operator could not find part B." });
    expect(raised.json().exceptions[0]).toMatchObject({ provenance: "operator", event_id: event.id, status: "open" });
    expect((await request(id, "POST", "/api/review/exceptions", { ...guard(id), title: "Bad link", event_id: "missing" })).statusCode).toBe(404);
  });
  it("bounds decision history while preserving its origin and disclosing omitted decisions", async () => {
    const { id, s } = await fresh();
    await request(id, "POST", "/api/review/exceptions", { ...guard(id), title: "Repeated review", operator_label: "Origin operator" });
    const issue = reviewSnapshot(s).exceptions[0];
    for (let index = 0; index < 30; index++) await request(id, "PATCH", `/api/review/exceptions/${issue.id}`, { ...guard(id), status: "acknowledged", note: `Review ${index}`, operator_label: "Reviewer" });
    const retained = reviewSnapshot(s).exceptions[0];
    expect(retained.history).toHaveLength(REVIEW_LIMITS.history);
    expect(retained.history[0].operator).toBe("Origin operator");
    expect(retained.history.at(-1)?.note).toBe("Review 29");
    expect(retained.history_omitted).toBe(11);
  });
  it("exports coherent provenance, unknown criteria, operator checks and retained evidence in JSON and ZIP", async () => {
    const { id, s } = await fresh();
    await observe(id);
    s.operatorGoals = "Focus on setup";
    const response = await request(id, "GET", "/api/review/handoff");
    const handoff = response.json();
    expect(response.headers["content-disposition"]).toContain("process-guide-handoff.json");
    expect(handoff.source).toMatchObject({ id: "test-video", name: "Inspection video", current_time_s: 10 });
    expect(handoff.operator_goals).toBe("Focus on setup");
    expect(handoff.unresolved_criteria.some((item: { step_id: string }) => item.step_id === "S2")).toBe(true);
    expect(handoff.open_exceptions).toHaveLength(1);
    expect(handoff.evidence[0].provenance).toBe("ai");
    expect(handoff.progress[0].actions).toHaveLength(1);
    const zip = new AdmZip((await request(id, "GET", "/api/dataset")).rawPayload);
    expect(JSON.parse(zip.readAsText("review.json")).events).toHaveLength(1);
    expect(JSON.parse(zip.readAsText("handoff.json")).reference.reference_key).toBe(referenceKey(s));
  });
  it("bounds metadata and thumbnails while retaining the newest evidence", async () => {
    const { s } = await fresh();
    const review = syncReview(s);
    for (let index = 0; index < 180; index++) appendReviewEvent(review, { id: String(index), source_id: s.sourceId, reference_key: review.reference_key, kind: "bookmark", provenance: "operator", occurred_at: index, video_time_s: index, summary: "Saved", guidance: "", concern: "", status: "ok", step_ids: [], thumbnail_b64: `data:image/jpeg;base64,${"a".repeat(30000)}` });
    const snapshot = reviewSnapshot(s);
    expect(snapshot.events).toHaveLength(REVIEW_LIMITS.events);
    expect(snapshot.events.at(-1)?.id).toBe("179");
    expect(snapshot.retention.retained_thumbnails).toBeLessThanOrEqual(REVIEW_LIMITS.thumbnails);
    expect(snapshot.retention.retained_thumbnail_bytes).toBeLessThanOrEqual(REVIEW_LIMITS.thumbnail_bytes);
    expect(snapshot.retention.dropped_events).toBe(30);
    expect(snapshot.retention.dropped_thumbnails).toBeGreaterThan(0);
  });
  it("distinguishes system/demo evidence and never raises exceptions from whole-video overview", async () => {
    const { s } = await fresh();
    const observation = ObservationSchema.parse({ summary: "Overview", guidance: "Review", concern: "Possible future issue", status: "watch" });
    captureObservationReview(s, observation, { time: 5, milestones: [], overview: true, occurredAt: Date.now() });
    captureObservationReview(s, observation, { time: 5, milestones: [], simulated: true, occurredAt: Date.now() });
    expect(reviewSnapshot(s).exceptions).toHaveLength(0);
    expect(reviewSnapshot(s).events.map(event => event.provenance)).toEqual(["ai", "system"]);
    expect(reviewSnapshot(s).events[0].observation_scope).toBe("overview");
  });
  it("does not commit observations or evidence from an aborted provider request", async () => {
    const { s } = await fresh();
    const controller = new AbortController();
    const engine = new GuidanceEngine(async input => { const answer = await fixtureComplete(input); controller.abort(); return answer; });
    await expect(engine.analyze(s, FrameBody.parse({ source_id: s.sourceId, frames_b64: [frame], current_s: 3 }), controller.signal)).rejects.toBeDefined();
    expect(s.observations).toHaveLength(0);
    expect(reviewSnapshot(s).events).toHaveLength(0);
    expect(s.workflow.steps.every(step => !step.complete)).toBe(true);
  });
  it("downloads PDF and HTML reports with bounded provenance and escaped operator text", async () => {
    const { id, s } = await fresh();
    s.operatorGoals = "<script>alert('bad')</script> — café guidance";
    await observe(id);
    const query = new URLSearchParams(Object.fromEntries(Object.entries(guard(id)).map(([key, value]) => [key, String(value)])));
    const html = await request(id, "GET", `/api/review/report.html?${query}`);
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("&lt;script&gt;");
    expect(html.body).not.toContain("<script>alert");
    const pdf = await request(id, "GET", `/api/review/report.pdf?${query}`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.headers["content-disposition"]).toContain("process-guide-analysis.pdf");
  });
  it("rejects incomplete and stale report guards", async () => {
    const { id } = await fresh();
    const scope = guard(id);
    expect((await request(id, "GET", "/api/review/report.pdf?source_id=test-video")).statusCode).toBe(400);
    await request(id, "PUT", "/api/review/readiness", { ...scope, job: { work_order: "Changed" } });
    const query = new URLSearchParams(Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, String(value)])));
    expect((await request(id, "GET", `/api/review/report.pdf?${query}`)).statusCode).toBe(409);
  });
  it("captures a coherent report snapshot and rejects changed context while rendering", async () => {
    const { id, s } = await fresh();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let captured: ReturnType<typeof structuredHandoff> | undefined;
    const spy = vi.spyOn(reportRenderer, "renderAnalysisPdf").mockImplementation(async snapshot => { captured = snapshot; entered(); await gate; return Buffer.from("%PDF-test"); });
    try {
      const pending = request(id, "GET", "/api/review/report.pdf");
      await started;
      const oldName = captured!.source.name;
      await request(id, "POST", "/api/source", { source_id: "replacement", kind: "camera", name: "Replacement view" });
      expect(captured!.source.name).toBe(oldName);
      expect(captured!.source.id).toBe("test-video");
      release();
      expect((await pending).statusCode).toBe(409);
      expect(s.sourceId).toBe("replacement");
    } finally { release(); spy.mockRestore(); }
  });
  it("rejects progress or guidance-goal changes during report generation even when review version is unchanged", async () => {
    for (const change of ["progress", "goals"] as const) {
      const { id, s } = await fresh();
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const spy = vi.spyOn(reportRenderer, "renderAnalysisPdf").mockImplementation(async () => { entered(); await gate; return Buffer.from("%PDF-test"); });
      try {
        const before = reviewSnapshot(s).review_version;
        const pending = request(id, "GET", "/api/review/report.pdf");
        await started;
        if (change === "progress") await request(id, "POST", "/api/workflow/steps/S1/confirm", { complete: true, current_s: 1 });
        else await request(id, "PUT", "/api/preferences", { operator_goals: "Use concise French", preferences_revision: 0 });
        expect(reviewSnapshot(s).review_version).toBe(before);
        release();
        expect((await pending).statusCode).toBe(409);
      } finally { release(); spy.mockRestore(); }
    }
  });
  it("rejects stale progress/goal report query values before rendering", async () => {
    const { id, s } = await fresh();
    const query = new URLSearchParams(Object.fromEntries(Object.entries(guard(id)).map(([key, value]) => [key, String(value)])));
    query.set("revision", String(s.revision + 1));
    query.set("preferences_revision", "0");
    expect((await request(id, "GET", `/api/review/report.pdf?${query}`)).statusCode).toBe(409);
  });
  it("prevents an old incident from extracting or returning the replacement video", async () => {
    const { id, s } = await fresh();
    s.videoPath = path.join(os.tmpdir(), `missing-original-${crypto.randomUUID()}.mp4`);
    s.videoInfo = { duration: 30, fps: 25, width: 128, height: 96 };
    expect((await request(id, "GET", "/api/video/clip?start_s=0&end_s=2&source_id=old-source")).statusCode).toBe(409);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const output = path.join(os.tmpdir(), `review-clip-${crypto.randomUUID()}.mp4`);
    fs.writeFileSync(output, "old video clip");
    const spy = vi.spyOn(framePipeline, "extractClip").mockImplementation(async () => { entered(); await gate; return output; });
    try {
      const pending = request(id, "GET", "/api/video/clip?start_s=0&end_s=2&source_id=test-video");
      await started;
      await request(id, "POST", "/api/source", { source_id: "new-camera", kind: "camera", name: "Replacement" });
      release();
      expect((await pending).statusCode).toBe(409);
      expect(fs.existsSync(output)).toBe(false);
    } finally { release(); spy.mockRestore(); fs.rmSync(output, { force: true }); }
  });
});

describe("asynchronous bookmark ownership", () => {
  async function gated() {
    const localStore = new SessionStore();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const localApp = await createApp({ store: localStore, reviewThumbnail: async input => { entered(); await gate; return makeReviewThumbnail(input); } });
    const id = crypto.randomUUID();
    const s = localStore.get(id); s.sourceId = "original"; s.sourceKind = "camera";
    const scope = reviewSnapshot(s);
    const payload = { source_id: scope.source_id, reference_key: scope.reference_key, review_version: scope.review_version, current_s: 2, frame_b64: frame };
    return { localStore, localApp, id, s, payload, started, release };
  }
  it("rejects source/reference changes during asynchronous image preparation", async () => {
    const { localApp, s, id, payload, started, release } = await gated();
    try {
      const pending = localApp.inject({ method: "POST", url: "/api/review/bookmarks", headers: { "x-guidance-session": id }, payload });
      await started;
      const parsed = parseDocument("new.txt", "Step 1 — New process\nActions: Inspect.");
      s.text = "Different reference"; s.rows = parsed.rows; s.workflow = parsed.workflow;
      release();
      expect((await pending).statusCode).toBe(409);
      expect(reviewSnapshot(s).events).toHaveLength(0);
    } finally { release(); await localApp.close(); }
  });
  it("does not commit a bookmark after the requesting client disconnects", async () => {
    const { localApp, s, id, payload, started, release } = await gated();
    const base = await localApp.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    try {
      const pending = fetch(`${base}/api/review/bookmarks`, { method: "POST", headers: { "x-guidance-session": id, "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal }).catch(() => undefined);
      await started;
      controller.abort();
      await pending;
      // Let the server receive the socket close before completing the image.
      await new Promise(resolve => setTimeout(resolve, 30));
      release();
      await vi.waitFor(() => expect(reviewSnapshot(s).events).toHaveLength(0));
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(reviewSnapshot(s).events).toHaveLength(0);
    } finally { release(); await localApp.close(); }
  });
});
