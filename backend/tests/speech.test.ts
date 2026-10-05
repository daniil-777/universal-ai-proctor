import { afterEach, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { speechRequest, tts } from "../src/media/speech.js";
import { createApp } from "../src/app.js";
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { audio = { speech: { create: mock.create } }; } }));
const original = { ...config.speech }, originalKey = config.keys.openai;
afterEach(() => { Object.assign(config.speech, original); config.keys.openai = originalKey; mock.create.mockReset(); });
it("uses professional delivery with Cedar and preserves the requested words", () => {
  config.speech.model = "gpt-4o-mini-tts"; config.speech.voice = "cedar";
  const request = speechRequest("Possibly 2.5 mm; verify before proceeding.");
  expect(request).toMatchObject({ model: "gpt-4o-mini-tts", voice: "cedar", input: "Possibly 2.5 mm; verify before proceeding.", response_format: "mp3" });
  expect(request.instructions).toContain("natural conversational tone");
  expect(request.instructions).toContain("professional, composed process guide");
  expect(request.instructions).toContain("Preserve numbers, cautions and uncertainty");
});
it("supports legacy model configuration without unsupported instructions", () => {
  config.speech.model = "tts-1";
  expect(speechRequest("Inspect the work area.", "nova").instructions).toBeUndefined();
  expect(() => speechRequest("Inspect the work area.", "marin")).toThrow("requires gpt-4o-mini-tts");
});
it("rejects unknown voices before asking the provider", () => {
  expect(() => speechRequest("Inspect the work area.", "unknown")).toThrow("supported speech voice");
});
it("passes request cancellation through to speech generation and returns playable bytes", async () => {
  config.keys.openai = "test-key";
  const controller = new AbortController(); const audio = Buffer.from("test audio");
  mock.create.mockResolvedValue(new Response(audio));
  expect(await tts("Check the work area.", "nova", controller.signal)).toEqual(audio);
  expect(mock.create.mock.calls[0][1].signal).toBe(controller.signal);
});
it("never sends an already canceled request to the provider", async () => {
  config.keys.openai = "test-key"; const controller = new AbortController(); controller.abort();
  await expect(tts("A canceled answer.", undefined, controller.signal)).rejects.toThrow();
  expect(mock.create).not.toHaveBeenCalled();
});
it("rejects audio that finishes after its owner cancels", async () => {
  config.keys.openai = "test-key"; const controller = new AbortController();
  let resolve!: (value: ArrayBuffer) => void;
  mock.create.mockResolvedValue({ arrayBuffer: () => new Promise<ArrayBuffer>(r => { resolve = r; }) });
  const pending = tts("A previous answer.", undefined, controller.signal); await Promise.resolve();
  controller.abort(); resolve(new ArrayBuffer(8)); await expect(pending).rejects.toThrow();
});
it("returns uncached audio and validates blank text and unsupported voices at the route", async () => {
  config.keys.openai = "test-key"; const app = await createApp();
  mock.create.mockImplementation(async () => new Response(Buffer.from("playable test bytes")));
  try {
    const good = await app.inject({ method: "POST", url: "/api/tts", payload: { text: "Inspect the work area." } });
    expect(good.statusCode).toBe(200); expect(good.headers["content-type"]).toBe("audio/mpeg");
    expect(good.headers["cache-control"]).toBe("no-store"); expect(good.rawPayload).toEqual(Buffer.from("playable test bytes"));
    for (const payload of [{ text: "   " }, { text: "Inspect the work area.", voice: "unknown" }])
      expect((await app.inject({ method: "POST", url: "/api/tts", payload })).statusCode).toBe(400);
    expect(mock.create).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});
it("aborts provider synthesis when an HTTP client disconnects", async () => {
  config.keys.openai = "test-key"; const app = await createApp(); const owner = new AbortController();
  let providerSignal!: AbortSignal, ready!: () => void; const started = new Promise<void>(r => { ready = r; });
  mock.create.mockImplementation((_body, options) => {
    providerSignal = options.signal; ready();
    return new Promise((_resolve, reject) => providerSignal.addEventListener("abort", () => reject(new Error("Canceled")), { once: true }));
  });
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const pending = fetch(address + "/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Cancel this speech." }), signal: owner.signal }).catch(() => {});
    await started; owner.abort(); await pending;
    await vi.waitFor(() => expect(providerSignal.aborted).toBe(true));
  } finally { owner.abort(); await app.close(); }
});
