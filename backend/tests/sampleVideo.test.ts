import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { AccountStore } from "../src/account/store.js";
import { SURGERY_SAMPLE } from "../src/media/sampleVideo.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";

const store = new SessionStore();
const accounts = new AccountStore({ file: ":memory:" });
const app = await createApp({ store, accountStore: accounts });
const samplePath = fileURLToPath(
  new URL(
    "../../sample-videos/uncomplicated-cholecystectomy.mp4",
    import.meta.url,
  ),
);
const id = crypto.randomUUID();
const request = (
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    payload,
    headers: { "x-guidance-session": id, ...headers },
  });
afterAll(async () => {
  await app.close();
  accounts.close();
  store.clear();
});

describe("original default surgery sample", () => {
  it("prepares a real source-owned surgical incident clip and reuses it without another encoder or AI call", async () => {
    const clipStore = new SessionStore();
    const clipAccounts = new AccountStore({ file: ":memory:" });
    let fixtureCalls = 0;
    const clipApp = await createApp({
      store: clipStore,
      accountStore: clipAccounts,
      engine: new GuidanceEngine(async () => {
        fixtureCalls++;
        return JSON.stringify({
          summary: "Fixture visibility concern for clip delivery testing",
          guidance: "Review the recorded moment",
          status: "watch",
          concern: "Fixture: review visibility",
          steps: [],
        });
      }),
    });
    const sessionId = crypto.randomUUID(),
      sourceId = crypto.randomUUID();
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "surgical-clip-test-"),
    );
    const headers = { "x-guidance-session": sessionId };
    try {
      await clipApp.inject({
        method: "POST",
        url: "/api/source",
        headers,
        payload: {
          source_id: sourceId,
          kind: "video",
          name: SURGERY_SAMPLE.name,
        },
      });
      await clipApp.inject({
        method: "POST",
        url: "/api/video/load-sample",
        headers,
        payload: { id: SURGERY_SAMPLE.id, source_id: sourceId },
      });
      const analyzed = await clipApp.inject({
        method: "POST",
        url: "/api/guidance/analyze",
        headers,
        payload: {
          source_id: sourceId,
          current_s: 105,
          n_samples: 4,
          window_s: 5,
          demo: false,
        },
      });
      expect(analyzed.statusCode).toBe(200);
      expect(analyzed.json().used_frames).toBe(4);
      const review = (
        await clipApp.inject({
          method: "GET",
          url: "/api/review?include_images=false",
          headers,
        })
      ).json();
      const event = review.events.find(
        (item: { status: string }) => item.status === "watch",
      );
      const url = `/api/review/incidents/${event.id}/clip?source_id=${sourceId}&reference_key=${review.reference_key}`;
      const clip = await clipApp.inject({ method: "GET", url, headers });
      expect(clip.statusCode).toBe(200);
      expect(clip.headers["content-type"]).toContain("video/mp4");
      expect(Number(clip.headers["x-guardian-clip-start"])).toBeCloseTo(
        event.video_time_s - 6,
        3,
      );
      expect(Number(clip.headers["x-guardian-clip-end"])).toBeCloseTo(
        event.video_time_s + 3,
        3,
      );
      const file = path.join(directory, "surgical-incident.mp4");
      fs.writeFileSync(file, clip.rawPayload);
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
          { encoding: "utf8" },
        ),
      );
      expect(Number(probe.format.duration)).toBeCloseTo(9, 1);
      expect(probe.streams[0].codec_name).toBe("h264");
      expect(probe.streams[0].width).toBe(660);
      expect(
        probe.streams.some(
          (stream: { codec_type: string }) => stream.codec_type === "audio",
        ),
      ).toBe(false);
      const reused = await clipApp.inject({ method: "GET", url, headers });
      expect(reused.rawPayload).toEqual(clip.rawPayload);
      const range = await clipApp.inject({
        method: "GET",
        url,
        headers: { ...headers, range: "bytes=0-63" },
      });
      expect(range.statusCode).toBe(206);
      expect(range.rawPayload).toEqual(clip.rawPayload.subarray(0, 64));
      expect(fixtureCalls).toBe(1);
    } finally {
      await clipApp.close();
      clipAccounts.close();
      clipStore.clear();
      fs.rmSync(directory, { recursive: true, force: true });
    }
 }, 15000);
  it("advertises the original default with its matching preserved guidance and unchanged recording", async () => {
    const catalog = (await request("GET", "/api/samples")).json();
    expect(catalog.videos).toContainEqual(SURGERY_SAMPLE);
    expect(
      catalog.documents.some(
        (item: { filename: string }) =>
          item.filename === SURGERY_SAMPLE.guidance,
      ),
    ).toBe(true);
    expect(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(samplePath))
        .digest("hex"),
    ).toBe("41eff5c46aec953cbabe7861213fb7d7c30a6f0c702066034623630b61a0e1fd");
  });

  it("loads the real video with matching guidance and streams byte ranges without browser upload", async () => {
    await request("POST", "/api/source", {
      source_id: "surgery-source-A",
      kind: "video",
      name: SURGERY_SAMPLE.name,
    });
    const loaded = await request("POST", "/api/video/load-sample", {
      id: SURGERY_SAMPLE.id,
      source_id: "surgery-source-A",
    });
    expect(loaded.statusCode).toBe(200);
    const data = loaded.json();
    expect(data.filename).toBe("Cholecystectomy.txt");
    expect(data.info.duration).toBeCloseTo(252.766667, 2);
    expect(data.info.width).toBe(660);
    expect(data.workflow.steps.length).toBeGreaterThan(3);
    expect(
      data.workflow.steps.every(
        (step: { complete: boolean }) => !step.complete,
      ),
    ).toBe(true);
    expect(data.source_id).toBe("surgery-source-A");
    const stream = await request("GET", data.stream_url, undefined, {
      range: "bytes=0-63",
    });
    expect(stream.statusCode).toBe(206);
    expect(stream.headers["content-range"]).toBe("bytes 0-63/37894412");
    expect(stream.rawPayload).toEqual(
      fs.readFileSync(samplePath).subarray(0, 64),
    );
    expect(path.resolve(store.get(id).videoPath!)).not.toBe(
      path.resolve(samplePath),
    );
  });

  it("rejects stale sources and unknown/path-like sample identifiers", async () => {
    expect(
      (
        await request("POST", "/api/video/load-sample", {
          id: SURGERY_SAMPLE.id,
          source_id: "old-source",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request("POST", "/api/video/load-sample", {
          id: "../secret.mp4",
          source_id: "surgery-source-A",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          "GET",
          "/api/video/stream?source_id=old-source",
          undefined,
          { range: "bytes=0-63" },
        )
      ).statusCode,
    ).toBe(409);
  });

  it("removes only the session's staging file and leaves the default sample intact", async () => {
    const staged = store.get(id).videoPath!;
    expect((await request("DELETE", "/api/video")).statusCode).toBe(200);
    expect(fs.existsSync(staged)).toBe(false);
    expect(fs.statSync(samplePath).size).toBe(37_894_412);
    expect((await request("GET", "/api/video/stream")).statusCode).toBe(404);
  });

  it("omits the menu option and returns an actionable error if the sample is not installed", async () => {
    const missingStore = new SessionStore();
    const missingAccounts = new AccountStore({ file: ":memory:" });
    const missing = await createApp({
      store: missingStore,
      accountStore: missingAccounts,
      sampleVideoRoot: path.join(path.dirname(samplePath), "not-installed"),
    });
    try {
      const catalog = (
        await missing.inject({ method: "GET", url: "/api/samples" })
      ).json();
      expect(catalog.videos).toEqual([]);
      await missing.inject({
        method: "POST",
        url: "/api/source",
        headers: { "x-guidance-session": id },
        payload: { source_id: "source", kind: "video", name: "Sample" },
      });
      const result = await missing.inject({
        method: "POST",
        url: "/api/video/load-sample",
        headers: { "x-guidance-session": id },
        payload: { id: SURGERY_SAMPLE.id, source_id: "source" },
      });
      expect(result.statusCode).toBe(404);
      expect(result.json().error).toContain("unavailable");
    } finally {
      await missing.close();
      missingAccounts.close();
      missingStore.clear();
    }
  });
});
