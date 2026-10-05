import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { AccountStore } from "../src/account/store.js";
import * as samples from "../src/media/sampleVideo.js";
import { REAL_SCENARIO_SAMPLES } from "../src/media/realScenarioSamples.js";

// Exercise the catalog without changing or relying on licensed production media.
vi.mock("../src/media/realScenarioSamples.js", () => ({
  REAL_SCENARIO_SAMPLES: [
    {
      id: "real-house-construction",
      name: "House observation fixture.mp4",
      filename: "real-01-house.mp4",
      guidance: "Real_01_House_Construction.txt",
      description: "Synthetic test fixture, not real observational evidence",
      default: false,
      duration_s: 150,
      source_url: "https://example.org/fixture-house",
      author: "Fixture author",
      license: "CC BY-SA 4.0",
      license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
      excerpt: { start_s: 30, end_s: 180, source_duration_s: 300 },
      changes: "Fixture for catalog behavior tests",
    },
    {
      id: "real-dancing",
      name: "Dance observation fixture",
      filename: "real-04-dancing.mp4",
      guidance: "Real_04_Dancing.txt",
      description: "Synthetic test fixture, not real observational evidence",
      default: false,
      duration_s: 125,
    },
  ],
}));

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guide-sample-catalog-"));
const videoRoot = path.join(directory, "videos");
const library = path.join(directory, "guidance");
const store = new SessionStore();
const accounts = new AccountStore({ file: ":memory:" });
let app: Awaited<ReturnType<typeof createApp>>;
const request = (
  id: string,
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) => app.inject({ method, url, payload, headers: { "x-guidance-session": id, ...headers } });
const startSource = (id: string, source = crypto.randomUUID()) =>
  request(id, "POST", "/api/source", { source_id: source, kind: "video", name: "Fixture" }).then(() => source);
const load = (id: string, source: string, sample = REAL_SCENARIO_SAMPLES[0]) =>
  request(id, "POST", "/api/video/load-sample", { id: sample.id, source_id: source });

beforeAll(async () => {
  fs.mkdirSync(videoRoot);
  fs.mkdirSync(library);
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=160x90:r=10:d=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(videoRoot, REAL_SCENARIO_SAMPLES[0].filename),
  ]);
  fs.copyFileSync(path.join(videoRoot, REAL_SCENARIO_SAMPLES[0].filename), path.join(videoRoot, REAL_SCENARIO_SAMPLES[1].filename));
  for (const sample of REAL_SCENARIO_SAMPLES) {
    fs.writeFileSync(path.join(library, sample.guidance), `Principles:\n- This is an observational test fixture; hidden measurements remain unknown.\nStep 1: ${sample.id} starting view (00:00-00:01)\nActions:\n- Identify the visible starting view.\nCriteria:\n- Visual observation: The starting view is visible.\nStep 2: ${sample.id} finishing view (00:01-00:02)\nActions:\n- Identify the finishing view only if shown.\nCriteria:\n- Visual observation: The finishing view is visible.\n`);
  }
  const originalRoot = fileURLToPath(new URL("../../sample-videos/", import.meta.url));
  fs.copyFileSync(path.join(originalRoot, samples.SURGERY_SAMPLE.filename), path.join(videoRoot, samples.SURGERY_SAMPLE.filename));
  fs.copyFileSync(fileURLToPath(new URL("../../guidance-library/Cholecystectomy.txt", import.meta.url)), path.join(library, samples.SURGERY_SAMPLE.guidance));
  app = await createApp({ store, accountStore: accounts, sampleVideoRoot: videoRoot, libraryRoot: library });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await app?.close();
  accounts.close();
  store.clear();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("bundled real-scenario catalog", () => {
  it("advertises attribution and the preserved default, omitting an incomplete pair", async () => {
    const id = crypto.randomUUID();
    const catalog = (await request(id, "GET", "/api/samples")).json();
    expect(catalog.videos).toContainEqual(samples.SURGERY_SAMPLE);
    expect(catalog.videos).toContainEqual(REAL_SCENARIO_SAMPLES[0]);
    expect(catalog.videos).toHaveLength(3);
    const guidance = path.join(library, REAL_SCENARIO_SAMPLES[1].guidance);
    fs.renameSync(guidance, `${guidance}.pending`);
    try {
      expect((await request(id, "GET", "/api/samples")).json().videos.map((v: { id: string }) => v.id)).toEqual([
        samples.SURGERY_SAMPLE.id, REAL_SCENARIO_SAMPLES[0].id,
      ]);
      const source = await startSource(id);
      const missing = await load(id, source, REAL_SCENARIO_SAMPLES[1]);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toContain("matching guidance");
      expect(store.get(id).videoPath).toBeUndefined();
    } finally {
      fs.renameSync(`${guidance}.pending`, guidance);
    }
  });

  it("loads the matching reference with measured video info, source-owned ranges and isolation", async () => {
    const id = crypto.randomUUID(), other = crypto.randomUUID();
    const source = await startSource(id);
    const loaded = await load(id, source);
    expect(loaded.statusCode).toBe(200);
    const data = loaded.json();
    expect(data.filename).toBe(REAL_SCENARIO_SAMPLES[0].guidance);
    expect(data.sample_video_id).toBe(REAL_SCENARIO_SAMPLES[0].id);
    expect(data.workflow.steps[0].name).toContain("real-house-construction");
    expect(data.workflow.steps.every((s: { complete: boolean; criteria: { status: string }[] }) => !s.complete && s.criteria.every(c => c.status === "unknown"))).toBe(true);
    expect(data.info.duration).toBeCloseTo(2);
    const bytes = fs.readFileSync(path.join(videoRoot, REAL_SCENARIO_SAMPLES[0].filename));
    const stream = await request(id, "GET", data.stream_url, undefined, { range: "bytes=0-31" });
    expect(stream.statusCode).toBe(206);
    expect(stream.rawPayload).toEqual(bytes.subarray(0, 32));
    expect(stream.headers["content-range"]).toBe(`bytes 0-31/${bytes.length}`);
    expect((await request(other, "GET", "/api/video/stream")).statusCode).toBe(404);
    expect((await request(other, "GET", "/api/reference")).json().rows_count).toBe(0);
  });

  it("restores explicit bundled provenance and never attributes a same-named custom upload", async () => {
    const id = crypto.randomUUID(), source = await startSource(id);
    await load(id, source);
    const restored = (await request(id, "GET", "/api/session")).json();
    expect(restored.video.sample_video_id).toBe(REAL_SCENARIO_SAMPLES[0].id);
    await startSource(id);
    expect(store.get(id).sampleVideoId).toBeUndefined();
    const boundary = `fixture-${crypto.randomUUID()}`;
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${REAL_SCENARIO_SAMPLES[0].name}"\r\nContent-Type: video/mp4\r\n\r\n`),
      fs.readFileSync(path.join(videoRoot, REAL_SCENARIO_SAMPLES[0].filename)),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({ method: "POST", url: "/api/video/upload", headers: { "x-guidance-session": id, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(upload.statusCode).toBe(200);
    const custom = (await request(id, "GET", "/api/session")).json();
    expect(custom.video.name).toBe(REAL_SCENARIO_SAMPLES[0].name);
    expect(custom.video.sample_video_id).toBeNull();
    expect(store.get(id).sampleVideoId).toBeUndefined();
    await load(id, store.get(id).sourceId);
    expect(store.get(id).sampleVideoId).toBe(REAL_SCENARIO_SAMPLES[0].id);
    await request(id, "DELETE", "/api/video");
    expect(store.get(id).sampleVideoId).toBeUndefined();
    expect((await request(id, "GET", "/api/session")).json().video).toBeNull();
  });

  it("replaces guidance and clears confirmed progress without modifying either bundled recording", async () => {
    const id = crypto.randomUUID(), source = await startSource(id);
    await load(id, source);
    const oldStaging = store.get(id).videoPath!;
    const confirmation = await request(id, "POST", "/api/workflow/steps/S1/confirm", { complete: true, source_id: source, current_s: 1 });
    expect(confirmation.statusCode).toBe(200);
    expect(store.get(id).workflow.steps[0].complete).toBe(true);
    const replacement = await startSource(id);
    const loaded = await load(id, replacement, REAL_SCENARIO_SAMPLES[1]);
    expect(loaded.json().filename).toBe(REAL_SCENARIO_SAMPLES[1].guidance);
    expect(loaded.json().workflow.steps[0].name).toContain("real-dancing");
    expect(store.get(id).workflow.steps.every(s => !s.complete)).toBe(true);
    expect(fs.existsSync(oldStaging)).toBe(false);
    await request(id, "DELETE", "/api/video");
    for (const sample of REAL_SCENARIO_SAMPLES) expect(fs.statSync(path.join(videoRoot, sample.filename)).size).toBeGreaterThan(0);
  });

  it("rejects unknown, path-like and stale sample selections without attaching media", async () => {
    const id = crypto.randomUUID(), source = await startSource(id);
    expect((await request(id, "POST", "/api/video/load-sample", { id: "real-not-installed", source_id: source })).statusCode).toBe(400);
    expect((await request(id, "POST", "/api/video/load-sample", { id: "../secret", source_id: source })).statusCode).toBe(400);
    expect((await load(id, "stale-source")).statusCode).toBe(409);
    expect(store.get(id).videoPath).toBeUndefined();
  });

  it("discards and cleans a staged video if the source changes during loading", async () => {
    const id = crypto.randomUUID(), source = await startSource(id);
    const originalStage = samples.stageSampleVideo;
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let target = "";
    vi.spyOn(samples, "stageSampleVideo").mockImplementationOnce(async (...args) => {
      target = args[3];
      entered();
      await blocked;
      return originalStage(...args);
    });
    const pending = load(id, source);
    await started;
    const nextSource = await startSource(id);
    release();
    expect((await pending).statusCode).toBe(409);
    expect(fs.existsSync(target)).toBe(false);
    expect(store.get(id).sourceId).toBe(nextSource);
    expect(store.get(id).videoPath).toBeUndefined();
    expect(store.get(id).filename).not.toBe(REAL_SCENARIO_SAMPLES[0].guidance);
  });

  it("keeps the latest selection when two different samples load for the same source", async () => {
    const id = crypto.randomUUID(), source = await startSource(id);
    const originalStage = samples.stageSampleVideo;
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let oldTarget = "";
    vi.spyOn(samples, "stageSampleVideo").mockImplementationOnce(async (...args) => {
      oldTarget = args[3];
      entered();
      await blocked;
      return originalStage(...args);
    });
    const first = load(id, source);
    await started;
    const latest = await load(id, source, REAL_SCENARIO_SAMPLES[1]);
    expect(latest.statusCode).toBe(200);
    const latestTarget = store.get(id).videoPath;
    release();
    expect((await first).statusCode).toBe(409);
    expect(fs.existsSync(oldTarget)).toBe(false);
    expect(store.get(id).videoPath).toBe(latestTarget);
    expect(store.get(id).filename).toBe(REAL_SCENARIO_SAMPLES[1].guidance);
  });
});
