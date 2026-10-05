import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createApp } from "../src/app.js";
import { SessionStore } from "../src/domain/session.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete, fixtureDocument, texturedFrame } from "./fixtures.js";
const store = new SessionStore();
const app = await createApp({
  store,
  engine: new GuidanceEngine(fixtureComplete),
});
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guide-source-races-"));
let base: string, video: Buffer;
beforeAll(async () => {
  base = await app.listen({ host: "127.0.0.1", port: 0 });
  const file = path.join(directory, "test.mp4");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x120:r=10",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-y",
    file,
  ]);
  video = fs.readFileSync(file);
});
afterAll(async () => {
  await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
const headers = (id: string) => ({ "x-guidance-session": id });
const source = (id: string, source_id: string, kind = "video") =>
  app.inject({
    method: "POST",
    url: "/api/source",
    headers: headers(id),
    payload: { source_id, kind, name: kind },
  });
function multipart(sourceId: string) {
  const boundary = `boundary-${crypto.randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="source_id"\r\n\r\n${sourceId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.mp4"\r\nContent-Type: video/mp4\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, head, tail };
}
describe("source and seek HTTP transactions", () => {
  it("prevents a slow video upload from restoring the old source after camera selection", async () => {
    const id = crypto.randomUUID();
    await source(id, "video-old");
    const { boundary, head, tail } = multipart("video-old");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const body = Readable.from(
      (async function* () {
        yield head;
        yield video.subarray(0, 256);
        await gate;
        yield video.subarray(256);
        yield tail;
      })(),
    );
    const upload = fetch(`${base}/api/video/upload`, {
      method: "POST",
      headers: {
        ...headers(id),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      duplex: "half",
    } as unknown as RequestInit);
    try {
      await vi.waitFor(() => expect(store.get(id).mediaGeneration).toBe(2));
      expect((await source(id, "camera-new", "camera")).statusCode).toBe(200);
    } finally {
      release();
    }
    expect((await upload).status).toBe(409);
    const s = store.get(id);
    expect(s.sourceId).toBe("camera-new");
    expect(s.videoPath).toBeUndefined();
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/video/stream",
          headers: headers(id),
        })
      ).statusCode,
    ).toBe(404);
  });
  it("rejects uploads labeled for a different source", async () => {
    const id = crypto.randomUUID();
    await source(id, "current", "camera");
    const { boundary, head, tail } = multipart("old");
    const response = await app.inject({
      method: "POST",
      url: "/api/video/upload",
      headers: {
        ...headers(id),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([head, video, tail]),
    });
    expect(response.statusCode).toBe(409);
    expect(store.get(id).videoPath).toBeUndefined();
  });
  it("invalidates in-flight analysis immediately when changing a source", async () => {
    const id = crypto.randomUUID();
    await source(id, "first");
    const s = store.get(id);
    const before = s.revision;
    await source(id, "second", "camera");
    const response = await app.inject({
      method: "POST",
      url: "/api/guidance/analyze",
      headers: headers(id),
      payload: {
        source_id: "first",
        revision: before,
        frames_b64: [await texturedFrame()],
      },
    });
    expect(response.statusCode).toBe(409);
    expect(s.sourceId).toBe("second");
  });
  it("restores known progress immediately on even a small backward seek", async () => {
    const id = crypto.randomUUID();
    await source(id, "video");
    await app.inject({
      method: "PUT",
      url: "/api/reference/document",
      headers: headers(id),
      payload: { text: fixtureDocument },
    });
    for (const [time, seed] of [
      [2, 0],
      [2.3, 1],
    ])
      await app.inject({
        method: "POST",
        url: "/api/guidance/analyze",
        headers: headers(id),
        payload: {
          source_id: "video",
          current_s: time,
          frames_b64: [await texturedFrame(seed)],
        },
      });
    expect(store.get(id).workflow.steps[0]!.complete).toBe(true);
    const response = await app.inject({
      method: "POST",
      url: "/api/workflow/seek",
      headers: headers(id),
      payload: { source_id: "video", current_s: 2.1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workflow.steps[0].complete).toBe(false);
    expect(response.json().workflow.steps[0].progress).toBe(50);
  });
  it("keeps operator confirmation in the timeline until seeking before its time", async () => {
    const id = crypto.randomUUID();
    await source(id, "video");
    await app.inject({
      method: "PUT",
      url: "/api/reference/document",
      headers: headers(id),
      payload: { text: fixtureDocument },
    });
    await app.inject({
      method: "POST",
      url: "/api/workflow/steps/S1/confirm",
      headers: headers(id),
      payload: { complete: true, current_s: 5 },
    });
    await app.inject({
      method: "POST",
      url: "/api/workflow/seek",
      headers: headers(id),
      payload: { source_id: "video", current_s: 6 },
    });
    expect(store.get(id).workflow.steps[0]!.confirmation).toBe("manual");
    await app.inject({
      method: "POST",
      url: "/api/workflow/seek",
      headers: headers(id),
      payload: { source_id: "video", current_s: 4 },
    });
    expect(store.get(id).workflow.steps[0]!.complete).toBe(false);
  });
});
