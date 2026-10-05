import { beforeEach, expect, it, vi } from "vitest";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create } }; } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {} }));
vi.mock("../src/config.js", () => ({
  config: { mock: false, keys: { openai: "fixture", hf: "fixture" } },
  modelSelection: (provider = "openai", model_id = "gpt-4o") => ({ provider, model_id }),
}));
import { complete } from "../src/llm/client.js";
import { observationFormat, supportsObservationSchema } from "../src/llm/observationFormat.js";

beforeEach(() => create.mockReset());
const input = { provider: "openai", prompt: "Observe the current view", systemPrompt: "Keep uncertainty explicit", frames: [Buffer.from("image-fixture")], maxTokens: 900, json: true, responseFormat: observationFormat, vision_detail: "high" as const };

it("supports controlled medium-reasoning comparisons without changing the production default", async () => {
  create.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
  await complete({ ...input, model_id: "gpt-6-astra", reasoning_effort: "medium" });
  expect(create.mock.calls[0]![0]).toMatchObject({ reasoning_effort: "medium", max_completion_tokens: 9092 });
});

it.each(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"])("sends a single compatible strict visual request for %s", async model_id => {
  create.mockResolvedValueOnce({ choices: [{ message: { content: '{"summary":"visible"}' }, finish_reason: "stop" }] });
  expect(await complete({ ...input, model_id })).toBe('{"summary":"visible"}');
  expect(create).toHaveBeenCalledOnce();
  const [request, options] = create.mock.calls[0]!;
  expect(request).toMatchObject({ model: model_id, reasoning_effort: "low", max_completion_tokens: 4996, response_format: observationFormat });
  expect(request).not.toHaveProperty("max_tokens");
  expect(request).not.toHaveProperty("temperature");
  expect(request.messages[1].content[1].image_url.detail).toBe("high");
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

it.each(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"])("preserves streamed text and reasoning-compatible parameters for %s", async model_id => {
  create.mockResolvedValueOnce((async function* () {
    yield { choices: [{ delta: { content: "Visible " } }] };
    yield { choices: [{ delta: {} }] };
    yield { choices: [{ delta: { content: "tool." }, finish_reason: "stop" }] };
  })());
  const onDelta = vi.fn();
  expect(await complete({ ...input, model_id, onDelta })).toBe("Visible tool.");
  expect(onDelta.mock.calls).toEqual([["Visible "], ["tool."]]);
  expect(create).toHaveBeenCalledOnce();
  expect(create.mock.calls[0]![0]).toMatchObject({ stream: true, reasoning_effort: "low", max_completion_tokens: 4996 });
});

it.each(["gpt-4o", "gpt-4.1"])("preserves the legacy token budget for %s while using its strict output support", async model_id => {
  create.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
  await complete({ ...input, model_id });
  expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 900, response_format: observationFormat });
  expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_effort");
  expect(create.mock.calls[0]![0]).not.toHaveProperty("max_completion_tokens");
});

it("does not send OpenAI-only reasoning or schema parameters to a compatible external provider", async () => {
  create.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
  await complete({ ...input, provider: "qwen", model_id: "gpt-6-astra" });
  expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 900 });
  for (const key of ["reasoning_effort", "max_completion_tokens", "response_format"]) expect(create.mock.calls[0]![0]).not.toHaveProperty(key);
});

it("retains JSON mode for unknown models and rejects an aborted request before any provider call", async () => {
  create.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });
  await complete({ ...input, model_id: "custom-vision-model" });
  expect(create.mock.calls[0]![0].response_format).toEqual({ type: "json_object" });
  const controller = new AbortController(); controller.abort();
  await expect(complete({ ...input, model_id: "gpt-6-astra", signal: controller.signal })).rejects.toThrow();
  expect(create).toHaveBeenCalledOnce();
  expect(supportsObservationSchema("gpt-6.1-astra")).toBe(false);
});
