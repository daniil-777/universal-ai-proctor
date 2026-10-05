import crypto from "node:crypto";
import sharp from "sharp";
import { afterAll, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { CompletionInput } from "../src/llm/client.js";
import { QUESTION_CONTRACT, VISUAL_DISCRIMINATION_RULE } from "../src/llm/questionContract.js";
import { decodeFrames, FrameBody, GuidanceEngine, prepareVisualInput } from "../src/pipeline/guidance.js";
import * as frameSampler from "../src/pipeline/frames.js";
import { SessionStore } from "../src/domain/session.js";
import { fixtureDocument, texturedFrame } from "./fixtures.js";

const answer = "A tool is visible, but its defining shape is unclear. The phase and its completion cannot be confirmed.";
const complete = vi.fn(async (input: CompletionInput) => {
  if (!input.json) { input.onDelta?.(answer); return answer; }
  return JSON.stringify({
    summary: "A tool is visible but its defining shape is unclear.",
    guidance: "Obtain a clearer view before identifying the phase.",
    status: "watch", current_step_id: null,
    steps: [{ id: "S1", confidence: 0.9, criteria: [{ key: "S1C1", status: "unknown", evidence: "The required object location cannot be confirmed.", frame_indices: [0] }] }],
  });
});
const app = await createApp({ engine: new GuidanceEngine(complete) });
const frame = await texturedFrame();
const request = (id: string, url: string, payload: object) => app.inject({ method: "POST", url, headers: { "x-guidance-session": id }, payload });
const input = { provider: "openai", model_id: "gpt-4o", current_s: 1, frames_b64: [frame], frame_times_s: [1], source_id: "default", vision_detail: "high" };
afterAll(async () => app.close());

it("delivers discrimination rules in one observation call and preserves unknown evidence without progress or extra retry calls", async () => {
  const id = crypto.randomUUID();
  await app.inject({ method: "PUT", url: "/api/reference/document", headers: { "x-guidance-session": id }, payload: { text: fixtureDocument } });
  const before = complete.mock.calls.length;
  const result = await request(id, "/api/guidance/analyze", input);
  expect(result.statusCode).toBe(200);
  expect(complete.mock.calls.length - before).toBe(1);
  const call = complete.mock.calls.at(-1)![0];
  expect(call.systemPrompt).toContain(VISUAL_DISCRIMINATION_RULE);
  expect(call.systemPrompt).toContain("set current_step_id=null");
  expect(call.systemPrompt).toContain("Only images within 1 second");
  expect(call).toMatchObject({ json: true, vision_detail: "high" });
  expect(call.frames).toHaveLength(1);
  expect(result.json().observation.current_step_id).toBeNull();
  expect(result.json().workflow.steps.every((step: { progress: number; complete: boolean }) => step.progress === 0 && !step.complete)).toBe(true);
  expect((await request(id, "/api/guidance/analyze", input)).json().cached).toBe(true);
  expect(complete.mock.calls.length - before).toBe(1);
});

it.each([false, true])("uses the shared high-priority uncertainty contract for question streaming=%s without adding provider calls", async stream => {
  const before = complete.mock.calls.length;
  const result = await request(crypto.randomUUID(), `/api/llm/ask${stream ? "/stream" : ""}`, { ...input, question: "Which phase is visible, and is it complete?", voice: stream });
  expect(result.statusCode).toBe(200);
  expect(complete.mock.calls.length - before).toBe(1);
  const call = complete.mock.calls.at(-1)![0];
  expect(call.systemPrompt).toBe(QUESTION_CONTRACT);
  expect(call.systemPrompt).toContain(VISUAL_DISCRIMINATION_RULE);
  expect(call.systemPrompt).toContain("nearly complete or likely complete");
  expect(call.frames).toHaveLength(1);
  if (stream) {
    expect(call.maxTokens).toBe(300);
    expect(call.prompt).toContain("one to three short, natural sentences");
    expect(result.body).toContain(answer);
    expect(result.body).toContain('"done":true');
  } else expect(result.json().answer).toBe(answer);
});

it.each(["high", "auto"] as const)("keeps the requested image detail with compression enabled: %s", async detail => {
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><rect width="1440" height="900" fill="white"/><path d="M0 0L1440 900M0 900L1440 0" stroke="navy" stroke-width="40"/></svg>')).jpeg().toBuffer();
  const decoded = await decodeFrames(FrameBody.parse({ frames_b64: [image.toString("base64")], compress: true, vision_detail: detail }));
  const metadata = await sharp(decoded[0]).metadata();
  expect(metadata.width).toBe(detail === "high" ? 1280 : 640);
  expect(metadata.height).toBe(detail === "high" ? 800 : 400);
});

it("requests sharper server frames and recent motion context without another sampling pass", async () => {
  const image = Buffer.from(frame, "base64");
  const sample = vi.spyOn(frameSampler, "sampleWindowFramesFast").mockResolvedValue([image]);
  const store = new SessionStore();
  try {
    const session = store.get(crypto.randomUUID());
    session.videoPath = "/fixture/video.mp4";
    session.videoInfo = { duration: 10, fps: 30, width: 1920, height: 1080 };
    const decoded = await decodeFrames(FrameBody.parse({ current_s: 5, compress: true, vision_detail: "high" }), session);
    expect(decoded).toEqual([image]);
    expect(sample).toHaveBeenCalledOnce();
    expect(sample.mock.calls[0]![4]).toMatchObject({ compress: false, recentMotion: true });
  } finally { sample.mockRestore(); store.clear(); }
});

it("preserves high-detail mosaic tiles through both direct decode and shared Guardian/question preparation", async () => {
  const body = FrameBody.parse({ current_s: 1, processing: "mosaic", mosaic_n: 2, frames_b64: [frame, frame], frame_times_s: [0.5, 1], compress: true, vision_detail: "high" });
  const direct = await decodeFrames(body);
  const prepared = await prepareVisualInput(body);
  expect(prepared.times).toEqual([0.5, 1]);
  expect(prepared.originals).toHaveLength(2);
  for (const images of [direct, prepared.frames]) {
    expect(images).toHaveLength(1);
    expect(await sharp(images[0]).metadata()).toMatchObject({ width: 1024, height: 1024 });
  }
});
