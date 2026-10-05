import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { AccountStore } from "../src/account/store.js";
import { SessionStore } from "../src/domain/session.js";
import { REAL_SCENARIO_SAMPLES } from "../src/media/realScenarioSamples.js";
import { SURGERY_SAMPLE } from "../src/media/sampleVideo.js";

const store = new SessionStore();
const accounts = new AccountStore({ file: ":memory:" });
let app: Awaited<ReturnType<typeof createApp>>;
const videoRoot = fileURLToPath(new URL("../../sample-videos/", import.meta.url));
beforeAll(async () => { app = await createApp({ store, accountStore: accounts }); });
afterAll(async () => { await app?.close(); accounts.close(); store.clear(); });

describe("verified real-footage library assets", () => {
  it("retains the original default and includes five uniquely identified, attributed real examples", async () => {
    expect(REAL_SCENARIO_SAMPLES.map(s => s.id)).toEqual([
      "real-house-construction", "real-manufacturing", "real-surgery", "real-dancing", "real-sport",
    ]);
    expect(new Set(REAL_SCENARIO_SAMPLES.map(s => s.filename)).size).toBe(5);
    expect(new Set(REAL_SCENARIO_SAMPLES.map(s => s.guidance)).size).toBe(5);
    const catalog = (await app.inject({ method: "GET", url: "/api/samples" })).json();
    expect(catalog.videos).toContainEqual(SURGERY_SAMPLE);
    for (const sample of REAL_SCENARIO_SAMPLES) {
      expect(catalog.videos).toContainEqual(sample);
      expect(sample.default).toBe(false);
      expect(sample.source_url).toMatch(/^https:\/\//);
      expect(sample.author?.trim()).toBeTruthy();
      expect(sample.license?.trim()).toBeTruthy();
      expect(sample.license_url).toMatch(/^https:\/\//);
      if (sample.excerpt) {
        expect(sample.excerpt.start_s).toBeGreaterThanOrEqual(0);
        expect(sample.excerpt.end_s).toBeGreaterThan(sample.excerpt.start_s);
      }
    }
  });

  for (const sample of REAL_SCENARIO_SAMPLES) {
    it(`loads ${sample.id} with its grounded, initially unconfirmed reference and real media ranges`, async () => {
      const session = crypto.randomUUID(), source = crypto.randomUUID();
      const headers = { "x-guidance-session": session };
      await app.inject({ method: "POST", url: "/api/source", headers, payload: { source_id: source, kind: "video", name: sample.name } });
      const result = await app.inject({ method: "POST", url: "/api/video/load-sample", headers, payload: { id: sample.id, source_id: source } });
      expect(result.statusCode).toBe(200);
      const data = result.json();
      expect(data.filename).toBe(sample.guidance);
      expect(data.source_id).toBe(source);
      expect(data.workflow.steps.length).toBeGreaterThanOrEqual(2);
      expect(data.workflow.warnings).toEqual([]);
      expect(data.workflow.principles.some((principle: string) => principle.includes(sample.source_url!))).toBe(true);
      expect(data.workflow.principles.some((principle: string) => principle.includes(sample.author!))).toBe(true);
      expect(data.workflow.steps.every((s: { complete: boolean; criteria: { status: string }[] }) => !s.complete && s.criteria.length > 0 && s.criteria.every(c => c.status === "unknown"))).toBe(true);
      expect(data.info.duration).toBeGreaterThanOrEqual(120);
      expect(data.info.duration).toBeLessThanOrEqual(180.1);
      expect(data.info.duration).toBeCloseTo(sample.duration_s, 0);
      expect(data.info.width).toBeGreaterThan(0);
      expect(data.info.height).toBeGreaterThan(0);
      const media = path.join(videoRoot, sample.filename);
      const bytes = fs.statSync(media).size;
      if (sample.bytes !== undefined) expect(bytes).toBe(sample.bytes);
      const range = await app.inject({ method: "GET", url: data.stream_url, headers: { ...headers, range: "bytes=0-63" } });
      expect(range.statusCode).toBe(206);
      expect(range.headers["content-range"]).toBe(`bytes 0-63/${bytes}`);
      const firstBytes = Buffer.alloc(64);
      const fd = fs.openSync(media, "r");
      try { fs.readSync(fd, firstBytes); } finally { fs.closeSync(fd); }
      expect(range.rawPayload).toEqual(firstBytes);
      const doc = (await app.inject({ method: "GET", url: "/api/reference/document", headers })).json();
      expect(doc.text).toContain(sample.source_url);
      expect(doc.text).toContain(sample.author);
      const staged = store.get(session).videoPath!;
      expect(staged).not.toBe(media);
      await app.inject({ method: "DELETE", url: "/api/video", headers });
      expect(fs.existsSync(staged)).toBe(false);
      expect(fs.statSync(media).size).toBe(bytes);
    });
  }
});
