import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { config } from "../src/config.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { VideoSummaryJobs } from "../src/media/videoSummaryJobs.js";
import { fixtureComplete } from "./fixtures.js";
import { initialSummaryQaControl, summaryQaComplete, type SummaryQaCall } from "../../scripts/video-summary-qa-data.mts";

const resources: Array<Awaited<ReturnType<typeof createApp>>> = [];
let frame: Buffer;
beforeAll(async () => { frame = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#13717b" } }).jpeg().toBuffer(); });
afterEach(async () => { await Promise.all(resources.splice(0).map(app => app.close())); });

async function fixture(loaded = true) {
  const store = new SessionStore(); const id = crypto.randomUUID(); const session = store.get(id);
  if (loaded) {
    const dir = path.join(config.uploadRoot, id); fs.mkdirSync(dir, { recursive: true });
    session.videoPath = path.join(dir, "route-fixture.mp4"); fs.writeFileSync(session.videoPath, "route fixture; injected sampler owns decoding");
    session.sourceId = "route-source"; session.sourceKind = "video"; session.sourceName = "Route fixture";
    session.videoInfo = { duration: 18, width: 32, height: 32, fps: 30 };
  }
  const control = initialSummaryQaControl(); const calls: SummaryQaCall[] = [];
  const manager = new VideoSummaryJobs({ allowMockForTests: true, complete: summaryQaComplete(() => control, calls),
    sampleFrames: async input => [{ buffer: frame, time_s: input.start_s + (input.end_s - input.start_s) / 3 }, { buffer: frame, time_s: input.start_s + (input.end_s - input.start_s) * 2 / 3 }],
  });
  const app = await createApp({ store, summaryJobs: manager, engine: new GuidanceEngine(fixtureComplete) }); resources.push(app);
  const request = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, sessionId = id) => app.inject({ method, url, payload, headers: { "x-guidance-session": sessionId } });
  const start = async () => {
    const plan = (await request("GET", "/api/video-summary/plan")).json().plan;
    return request("POST", "/api/video-summary/jobs", { source_id: plan.source_id, reference_key: plan.reference_key, mode: "detailed", include_audio: false });
  };
  const terminal = async (jobId: string) => {
    for (let i = 0; i < 200; i++) {
      const result = (await request("GET", `/api/video-summary/jobs/${jobId}`)).json().job;
      if (!["queued", "planning", "analyzing", "synthesizing"].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("Fixture recap did not finish");
  };
  return { app, store, session, manager, control, calls, request, start, terminal };
}

describe("session-scoped video recap HTTP workflow", () => {
  it("preflights without calling a model and rejects unsupported modes and missing source", async () => {
    const empty = await fixture(false);
    expect((await empty.request("GET", "/api/video-summary/plan")).statusCode).toBe(400);
    expect(empty.calls).toEqual([]);
    const f = await fixture();
    const response = await f.request("GET", "/api/video-summary/plan");
    expect(response.statusCode).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().plan).toMatchObject({ source_id: "route-source", duration_s: 18, total_windows: 3, mode: "detailed" });
    expect((await f.request("GET", "/api/video-summary/plan?mode=imaginary")).statusCode).toBe(400);
    expect(f.calls).toEqual([]);
  });
  it("rejects stale starts and isolates job IDs and JSON exports between sessions", async () => {
    const f = await fixture();
    expect((await f.request("POST", "/api/video-summary/jobs", { source_id: "old", reference_key: "old", mode: "detailed" })).statusCode).toBe(409);
    const response = await f.start(); expect(response.statusCode).toBe(202); const id = response.json().job.id;
    const other = crypto.randomUUID();
    for (const route of [`/api/video-summary/jobs/${id}`, `/api/video-summary/jobs/${id}/report.json`])
      expect((await f.request("GET", route, undefined, other)).statusCode).toBe(404);
    expect((await f.request("POST", `/api/video-summary/jobs/${id}/cancel`, {}, other)).statusCode).toBe(404);
    expect((await f.terminal(id)).status).toBe("complete");
    const calls = f.calls.length;
    const download = await f.request("GET", `/api/video-summary/jobs/${id}/report.json`);
    expect(download.statusCode).toBe(200); expect(download.headers["content-disposition"]).toContain("attachment;");
    expect(download.headers["cache-control"]).toBe("no-store"); expect(download.json()).toMatchObject({ id, schema_version: 1, provenance: { simulated: true } });
    expect(f.calls).toHaveLength(calls);
    await f.request("PUT", "/api/reference/document", { text: "Step 1: Different instructions" });
    expect((await f.request("GET", `/api/video-summary/jobs/${id}/report.json`)).body).toBe(download.body);
    expect((await f.request("GET", "/api/video-summary/jobs/current")).json().job).toBeNull();
  });
  it("refuses unfinished exports and cancels model work when the source is removed", async () => {
    const f = await fixture(); f.control.delay_ms = 1000;
    const id = (await f.start()).json().job.id;
    expect((await f.request("GET", `/api/video-summary/jobs/${id}/report.json`)).statusCode).toBe(409);
    expect((await f.request("DELETE", "/api/video")).statusCode).toBe(200);
    expect((await f.terminal(id)).status).toBe("stale");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.calls.some(call => call.outcome === "cancelled")).toBe(true);
  });
  it("invalidates active work immediately on instruction or goal edits", async () => {
    for (const [url, body] of [["/api/reference/document", { text: "Step 1: Updated work" }], ["/api/preferences", { operator_goals: "Inspect the label" }]] as const) {
      const f = await fixture(); f.control.delay_ms = 1000; const id = (await f.start()).json().job.id;
      expect((await f.request("PUT", url, body)).statusCode).toBe(200);
      expect((await f.terminal(id)).status).toBe("stale");
    }
  });
  it("session disposal cancels active jobs before removing their owned media", async () => {
    const f = await fixture(); f.control.delay_ms = 1000; const id = (await f.start()).json().job.id;
    const file = f.session.videoPath!; let existedAtDisposal = false;
    f.store.onDispose(() => { existedAtDisposal = fs.existsSync(file); });
    f.store.remove(f.session.id);
    expect(existedAtDisposal).toBe(true); expect(fs.existsSync(file)).toBe(false);
    expect(f.manager.get(f.session, id).status).toBe("stale");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(f.calls.some(call => call.outcome === "cancelled")).toBe(true);
  });
});
