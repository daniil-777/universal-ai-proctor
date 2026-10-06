import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { GuidanceEngine } from "../src/pipeline/guidance.js";
import { fixtureComplete, fixtureDocument, texturedFrame } from "./fixtures.js";
import type { CompletionInput } from "../src/llm/client.js";
const inputs: CompletionInput[] = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "answer-contract-"));
const app = await createApp({
  engine: new GuidanceEngine(async (input) => {
    inputs.push(input);
    return fixtureComplete(input);
  }),
  evaluationRoot: dir,
});
const id = crypto.randomUUID();
const request = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { "x-guidance-session": id },
    payload: payload as object,
  });
const image = await texturedFrame();
const body = {
  frames_b64: [image],
  frame_times_s: [2.5],
  current_s: 2.5,
  source_id: "answer-video",
  compress: false,
  vision_detail: "high",
};
await request("POST", "/api/source", {
  source_id: body.source_id,
  kind: "video",
  name: "answer.mp4",
});
await request("PUT", "/api/reference/document", { text: fixtureDocument });
describe("answer and benchmark contracts", () => {
  it("uses evidence-first system rules, actual timestamps, detail and separate reference data", async () => {
    inputs.length = 0;
    const r = await request("POST", "/api/llm/ask", {
      ...body,
      question: "What is visible?",
    });
    expect(r.statusCode).toBe(200);
    expect(inputs[0].systemPrompt).toContain("visible");
    expect(inputs[0].prompt).toContain("[2.5]");
    expect(inputs[0].prompt).toContain("Tool visibly on table");
    expect(inputs[0].vision_detail).toBe("high");
    expect(inputs[0].frames).toHaveLength(1);
    expect(inputs[0].prompt).toContain("Latest image quality: available.");
    expect(inputs[0].prompt).toContain("Visual images are supplied.");
    expect(inputs[0].prompt).not.toContain("if unusable or absent");
  });
  it("streams voice replies through the same visual contract and finishes exactly once", async () => {
    const r = await request("POST", "/api/llm/ask/stream", {
      ...body,
      question: "What next?",
      voice: true,
    });
    const events = r.body
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(6)));
    expect(events.filter((e) => e.done)).toHaveLength(1);
    expect(
      events
        .filter((e) => e.delta)
        .map((e) => e.delta)
        .join(""),
    ).toContain("tool");
    expect(inputs.at(-1)?.maxTokens).toBe(300);
    expect(inputs.at(-1)?.prompt).toContain("short, natural sentences");
    expect(inputs.at(-1)?.prompt).toContain("Keep necessary cautions, uncertainty, numbers");
    expect(inputs.at(-1)?.prompt).toContain("without greetings, headings, Markdown or lists");
  });
  it("explains the reference without images while preserving unconfirmed progress", async () => {
    const before = (await request("GET", "/api/workflow")).json();
    inputs.length = 0;
    const response = await request("POST", "/api/llm/ask", {
      ...body,
      frames_b64: [],
      frame_times_s: [],
      question: "Which documented cues should I look for?",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().used_frames).toBe(0);
    expect(inputs[0].frames).toHaveLength(0);
    expect(inputs[0].systemPrompt).toContain("explaining what to look for does not require seeing the current work");
    expect(inputs[0].prompt).toContain("lack of images does not prevent document guidance");
    expect(inputs[0].prompt).toContain("Tool visibly on table");
    expect((await request("GET", "/api/workflow")).json()).toEqual(before);
  });
  it("rejects obsolete source and workflow requests for questions and comparisons", async () => {
    for (const url of ["/api/llm/ask", "/api/llm/ask/stream", "/api/compare"]) {
      const extra =
        url === "/api/compare"
          ? { models: [{ provider: "openai", model_id: "gpt-4o-mini" }] }
          : { question: "What next?" };
      expect(
        (await request("POST", url, { ...body, ...extra, revision: 999 }))
          .statusCode,
      ).toBe(409);
      expect(
        (
          await request("POST", url, {
            ...body,
            ...extra,
            source_id: "old-source",
          })
        ).statusCode,
      ).toBe(409);
    }
  });
  it("compares with strict observation rules without mutating tracked progress", async () => {
    const before = (await request("GET", "/api/workflow")).json();
    inputs.length = 0;
    const r = await request("POST", "/api/compare", {
      ...body,
      models: [
        { provider: "openai", model_id: "gpt-4o-mini" },
        { provider: "openai", model_id: "gpt-4o" },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().results).toHaveLength(2);
    expect(
      inputs.every(
        (i) =>
          i.systemPrompt?.includes("current_step_id") &&
          i.responseFormat &&
          i.json,
      ),
    ).toBe(true);
    expect((await request("GET", "/api/workflow")).json()).toEqual(before);
  });
  it("blocks current visual claims without a provider call when an older frame remains clear", async () => {
    const black = (
      await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#000" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    const blocked = {
      ...body,
      frames_b64: [image, black],
      frame_times_s: [1.5, 2.5],
      question: "What is happening now?",
    };
    const before = inputs.length;
    const r = await request("POST", "/api/llm/ask", blocked);
    expect(r.json().answer).toContain("cannot be visually assessed");
    expect(inputs.length).toBe(before);
    expect(r.json().used_frames).toBe(0);
    const stream = await request("POST", "/api/llm/ask/stream", blocked);
    expect(stream.body).toContain("cannot be visually assessed");
    expect(stream.body).toContain('"done":true');
    expect(inputs.length).toBe(before);
  });
  it("keeps document questions available without sending old images as the current view", async () => {
    const black = (
      await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#000" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64");
    await request("POST", "/api/llm/ask", {
      ...body,
      frames_b64: [image, black],
      frame_times_s: [1.5, 2.5],
      question: "Explain the documented principle",
    });
    expect(inputs.at(-1)?.prompt).toContain("Latest image quality: unusable");
    expect(inputs.at(-1)?.frames).toHaveLength(0);
  });
  it("serves reviewed benchmark reports with current metadata and video byte ranges", async () => {
    expect(
      (await request("GET", "/api/evaluation/latest")).json().available,
    ).toBe(false);
    expect((await request("GET", "/evaluation")).statusCode).toBe(404);
    fs.mkdirSync(path.join(dir, "results"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(
      path.join(dir, "results/latest.json"),
      JSON.stringify({ metrics: { Listener: { cases: 2 } }, results: [] }),
    );
    fs.writeFileSync(
      path.join(dir, "results/latest.html"),
      "<html>Expected and actual answers</html>",
    );
    fs.writeFileSync(path.join(dir, "assets/video.mp4"), Buffer.alloc(100, 7));
    fs.writeFileSync(path.join(dir, "assets/secret.json"), "private");
    const metadata = await request("GET", "/api/evaluation/latest");
    expect(metadata.headers["cache-control"]).toBe("no-store");
    expect(metadata.json().metrics.Listener.cases).toBe(2);
    expect((await request("GET", "/evaluation")).body).toContain(
      "Expected and actual",
    );
    const range = await app.inject({
      url: "/evaluation/assets/video.mp4",
      headers: { range: "bytes=10-19" },
    });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toHaveLength(10);
    expect(
      (await request("GET", "/evaluation/assets/secret.json")).statusCode,
    ).toBe(404);
    expect(
      (await request("GET", "/evaluation/assets/missing.jpg")).statusCode,
    ).toBe(404);
  });
});
import { afterAll } from "vitest";
afterAll(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
