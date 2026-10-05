import { beforeAll, afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { createApp } from "../src/app.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete, fixtureDocument, texturedFrame } from "./fixtures.js";

const app = await createApp({ engine: new GuidanceEngine(fixtureComplete) });
const session = crypto.randomUUID(),
  other = crypto.randomUUID();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "process-guide-api-"));
let frame: string, video: Buffer;
const request = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  id = session,
) =>
  app.inject({
    method,
    url,
    headers: { "x-guidance-session": id },
    payload: payload as object,
  });
function upload(
  url: string,
  filename: string,
  contents: Buffer | string,
  id = session,
) {
  const boundary = `guidance-${crypto.randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    Buffer.from(contents),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: "POST",
    url,
    headers: {
      "x-guidance-session": id,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
}
beforeAll(async () => {
  frame = await texturedFrame();
  const file = path.join(directory, "video.mp4");
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x240:r=12",
    "-t",
    "6",
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
describe("HTTP workflows", () => {
  it("advertises working capabilities and all preserved sample documents", async () => {
    const health = (await request("GET", "/api/health")).json();
    expect(health.capabilities).toEqual({
      video: true,
      camera: true,
      document: true,
      simulator: false,
    });
    const samples = (await request("GET", "/api/samples")).json();
    expect(samples.documents.map((d: { filename: string }) => d.filename)).toEqual(
      expect.arrayContaining([
        "Bankart.txt",
        "Bankart_simple.txt",
        "bankart_completion_criteria_only.txt",
        "bankart_simplified_completion_criteria.txt",
        "Cholecystectomy.txt",
        "Coffee_Brewing.txt",
        "dataParametersLogic.txt",
        "dataParametersLogicStructured.txt",
      ]),
    );
    expect(
      samples.documents.some(
        (d: { filename: string }) => d.filename === "Cholecystectomy.txt",
      ),
    ).toBe(true);
  });
  it("loads a document and isolates it from another browser session", async () => {
    const r = await upload(
      "/api/reference/upload",
      "assembly.txt",
      fixtureDocument,
    );
    expect(r.statusCode).toBe(200);
    expect(r.json().rows_count).toBe(2);
    expect(
      (await request("GET", "/api/reference", undefined, other)).json()
        .rows_count,
    ).toBe(0);
  });
  it("rejects empty, unsupported, oversized and traversal documents", async () => {
    expect(
      (await upload("/api/reference/upload", "empty.txt", "")).statusCode,
    ).toBe(400);
    expect(
      (await upload("/api/reference/upload", "file.exe", "abc")).statusCode,
    ).toBe(400);
    expect(
      (
        await upload(
          "/api/reference/upload",
          "big.txt",
          "x".repeat(2 * 1024 * 1024 + 1),
        )
      ).statusCode,
    ).toBe(413);
    expect(
      (
        await request("POST", "/api/reference/load-sample", {
          filename: "../private.txt",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("edits raw guidance and always rebuilds right-panel steps", async () => {
    const r = await request("PUT", "/api/reference/document", {
      text: fixtureDocument.replace("Prepare", "Prepare carefully"),
      reparse: false,
    });
    expect(r.json().workflow.steps[0].name).toBe("Prepare carefully");
    expect(
      (await request("GET", "/api/reference/document")).json().text,
    ).toContain("Prepare carefully");
  });
  it("supports explicit AI refinement and row editing", async () => {
    expect(
      (await request("POST", "/api/reference/parse-ai", {})).json().rows_count,
    ).toBe(2);
    const r = await request("PUT", "/api/reference", {
      rows: [
        { step: "Prepare", actions: "Place tool", criteria: "Tool visible" },
        { step: "Finish", actions: "Store tool", criteria: "Tool stored" },
      ],
    });
    expect(r.json().rows_count).toBe(2);
  });
  it("validates missing frames, bad images and stale revisions", async () => {
    expect(
      (await request("POST", "/api/guidance/analyze", {})).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/guidance/analyze", {
          frames_b64: ["invalid"],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/guidance/analyze", {
          revision: 999,
          frames_b64: [frame],
        })
      ).statusCode,
    ).toBe(409);
  });
  it("records partial then confirmed evidence without completing unseen steps", async () => {
    const r1 = await request("POST", "/api/guidance/analyze", {
      source_id: "test-video",
      current_s: 1,
      frames_b64: [frame],
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().workflow.steps[0].progress).toBe(50);
    const r2 = await request("POST", "/api/monitor/check", {
      source_id: "test-video",
      current_s: 2,
      frames_b64: [await texturedFrame(1)],
    });
    expect(r2.json().workflow.steps[0].complete).toBe(true);
    expect(r2.json().workflow.steps[1].complete).toBe(false);
  });
  it("labels manual confirmations and resets all progress", async () => {
    const r = await request("POST", "/api/workflow/steps/S2/confirm", {
      complete: true,
      current_s: 2,
    });
    expect(r.json().workflow.steps[1].confirmation).toBe("manual");
    const reset = await request("POST", "/api/workflow/reset", {});
    expect(
      reset
        .json()
        .workflow.steps.every((s: { progress: number }) => s.progress === 0),
    ).toBe(true);
  });
  it("streams chat with actual frame metadata and no progress changes", async () => {
    const before = (await request("GET", "/api/session")).json().stats.checks;
    const response = await request("POST", "/api/llm/ask/stream", {
      question: "What is visible?",
      frames_b64: [frame],
    });
    expect(response.headers["content-type"]).toMatch(/event-stream/);
    expect(response.body).toContain('"delta"');
    expect(response.body).toContain('"done":true');
    expect(response.body).toContain('"used_frames":1');
    expect((await request("GET", "/api/session")).json().stats.checks).toBe(
      before,
    );
  });
  it("answers regular questions, summarizes locally and digests history", async () => {
    expect(
      (
        await request("POST", "/api/llm/ask", {
          question: "Explain",
          frames_b64: [frame],
        })
      ).json().answer,
    ).toContain("visible tool");
    expect(
      (
        await request("POST", "/api/llm/summarize", {
          text: "First sentence. Second sentence.",
        })
      ).json().summary,
    ).toBe("First sentence.");
    expect(
      (
        await request("POST", "/api/history/digest", { events: ["One", "Two"] })
      ).json().digest,
    ).toBe("One · Two");
  });
  it("compares models without mutating session progress", async () => {
    const before = (await request("GET", "/api/session")).json().stats.checks;
    const r = await request("POST", "/api/compare", {
      frames_b64: [frame],
      models: [
        { provider: "openai", model_id: "gpt-4o-mini" },
        { provider: "google", model_id: "gemini-3-flash-preview" },
      ],
    });
    expect(r.json().results).toHaveLength(2);
    expect((await request("GET", "/api/session")).json().stats.checks).toBe(
      before,
    );
  });
  it("exports actual observations, workflow and document in a ZIP", async () => {
    const r = await request("GET", "/api/dataset");
    const zip = new AdmZip(r.rawPayload);
    expect(
      zip
        .getEntries()
        .map((e) => e.entryName)
        .sort(),
    ).toEqual([
      "README.txt",
      "handoff.json",
      "observations.json",
      "reference.txt",
      "review.json",
      "workflow.json",
    ]);
    expect(zip.readAsText("README.txt")).toContain("not verified ground truth");
    expect(JSON.parse(zip.readAsText("workflow.json")).steps).toHaveLength(2);
  });
  it("generates an evidence-based report and reserves simulator endpoints", async () => {
    const r = await request("POST", "/api/report/summary", {
      guardian: [],
      qa: [],
    });
    expect(r.json().overall).toContain("steps confirmed");
    expect(r.json().workflow.steps).toHaveLength(2);
    expect(
      (await request("GET", "/api/simulator/capabilities")).json().available,
    ).toBe(false);
    expect((await request("POST", "/api/sim/connect", {})).statusCode).toBe(
      501,
    );
  });
  it("uploads, probes and streams video with normal and suffix ranges", async () => {
    const r = await upload("/api/video/upload", "demo.mp4", video);
    expect(r.statusCode).toBe(200);
    expect(r.json().info.duration).toBeGreaterThan(5);
    const partial = await app.inject({
      method: "GET",
      url: "/api/video/stream",
      headers: { "x-guidance-session": session, range: "bytes=0-99" },
    });
    expect(partial.statusCode).toBe(206);
    expect(partial.rawPayload.length).toBe(100);
    const suffix = await app.inject({
      method: "GET",
      url: `/api/video/stream?session=${session}`,
      headers: { range: "bytes=-10" },
    });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload).toEqual(video.subarray(-10));
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/video/stream",
          headers: { "x-guidance-session": session, range: "bytes=999999-" },
        })
      ).statusCode,
    ).toBe(416);
    expect(
      (await request("GET", "/api/video/stream", undefined, other)).statusCode,
    ).toBe(404);
  });
  it("samples backend video, creates clips and restores session media", async () => {
    const overview = await request("POST", "/api/guidance/analyze", {
      source_id: "test-video",
      processing: "whole_video",
      current_s: 0,
      n_samples: 3,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().used_frames).toBe(3);
    expect(overview.json().workflow.steps[0].progress).toBe(0);
    expect(
      (
        await request("POST", "/api/guidance/analyze", {
          source_id: "test-video",
          current_s: 3,
          n_samples: 2,
        })
      ).json().used_frames,
    ).toBe(2);
    const clip = await request("GET", "/api/video/clip?start_s=1&end_s=3");
    expect(clip.statusCode).toBe(200);
    expect(clip.rawPayload.length).toBeGreaterThan(500);
    expect(
      (await request("GET", "/api/video/clip?start_s=3&end_s=1")).statusCode,
    ).toBe(400);
    expect(
      (await request("GET", "/api/session")).json().video.stream_url,
    ).toContain(session);
  });
  it("removes video and document then infers a provisional workflow", async () => {
    expect((await request("DELETE", "/api/video")).json().ok).toBe(true);
    expect((await request("GET", "/api/video/stream")).statusCode).toBe(404);
    await request("DELETE", "/api/reference");
    await request("POST", "/api/source", {
      source_id: "camera",
      kind: "camera",
      name: "Camera",
    });
    const r = await request("POST", "/api/workflow/infer", {
      source_id: "camera",
      frames_b64: [frame],
    });
    expect(r.json().workflow.source).toBe("inferred");
    expect(r.json().workflow.steps).toHaveLength(3);
  });
  it("validates session identifiers and malformed bodies", async () => {
    expect(
      (await request("GET", "/api/session", undefined, "../not-safe"))
        .statusCode,
    ).toBe(400);
    expect(
      (await request("POST", "/api/llm/ask", { question: "" })).statusCode,
    ).toBe(400);
    expect(
      (await request("PUT", "/api/reference", { rows: [{ step: 123 }] }))
        .statusCode,
    ).toBe(400);
  });
});
