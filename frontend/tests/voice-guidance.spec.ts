import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assets = fileURLToPath(new URL("../../evaluation/assets/", import.meta.url));
// Real, decodable provider audio; only the network/model timing is stubbed here.
const audio = fs.readFileSync(fileURLToPath(new URL("../../docs/voice-gpt-4o-mini-tts-1.mp3", import.meta.url)));
type Event = { kind: string; at: number; text?: string };
type Probe = { events: Event[]; finish?: (mode: string) => void; ask: (text: string) => void };
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { events: [], ask: () => {} };
    Object.assign(window, { __voiceProbe: probe });
    const record = (kind: string, text?: string) => probe.events.push({ kind, text, at: performance.now() });
    const NativeAudio = window.Audio;
    window.Audio = function (...args: ConstructorParameters<typeof Audio>) {
      const el = new NativeAudio(...args);
      el.addEventListener("playing", () => { if (el.src.startsWith("blob:")) record("playing"); });
      el.addEventListener("ended", () => { if (el.src.startsWith("blob:")) record("ended"); });
      return el;
    } as typeof Audio;
    window.Audio.prototype = NativeAudio.prototype;
    const recognizers: FakeRecognition[] = [];
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      constructor() { recognizers.push(this); }
      start() { record("listening"); this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() {}
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
    probe.ask = (text) => {
      const recognizer = recognizers.at(-1)!;
      recognizer.onresult?.({ resultIndex: 0, results: { 0: { 0: { transcript: text, confidence: 1 }, length: 1, isFinal: true }, length: 1 } });
      recognizer.onend?.();
    };
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.endsWith("/api/llm/ask/stream")) {
        record("request");
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const write = (payload: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            write({ delta: "The blue part is visible. Check" }); record("sentence");
            let closed = false;
            probe.finish = mode => {
              if (closed) return;
              closed = true;
              if (mode === "error") write({ error: "Test provider failed" });
              else {
                write({ delta: " the reference before moving it." });
                if (mode === "success") write({ done: true, used_frames: 1 });
              }
              record(mode === "success" ? "done" : "failed"); controller.close();
            };
            args[1]?.signal?.addEventListener("abort", () => {
              if (!closed) { closed = true; record("aborted"); controller.error(new DOMException("Canceled", "AbortError")); }
            }, { once: true });
          },
        });
        return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
      }
      if (url.endsWith("/api/tts")) {
        const body = JSON.parse(String(args[1]?.body)); record("synthesis", body.text);
        const response = await originalFetch(...args);
        await response.clone().blob(); record("ready", body.text);
        return response;
      }
      return originalFetch(...args);
    };
  });
  await page.route("**/api/tts", async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ contentType: "audio/mpeg", body: audio }).catch(() => {});
  });
}
async function workspace(page: Page) {
  await page.goto("/");
  await page.getByTestId("intro-video-input").setInputFiles(path.join(assets, "parts-sorting.mp4"));
  await page.getByTestId("intro-document-input").setInputFiles(path.join(assets, "Parts_Sorting.txt"));
  await expect(page.getByText("Parts_Sorting.txt · 4 steps extracted")).toBeVisible();
  await page.getByRole("button", { name: "Open workspace" }).click();
  const sources = page.getByRole("button", { name: "Sources and setup" });
  const compact = await sources.isVisible();
  if (compact) await sources.click();
  await page.getByRole("button", { name: /^Pause guidance$/ }).click();
  if (compact) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.locator(".chat-panel").getByRole("button", { name: "Listen", exact: true }).click();
}
const events = (page: Page): Promise<Event[]> => page.evaluate(() => (window as unknown as { __voiceProbe: Probe }).__voiceProbe.events);
async function ask(page: Page) {
  await page.evaluate(() => (window as unknown as { __voiceProbe: Probe }).__voiceProbe.ask("Hey, what should I check?"));
  await expect.poll(async () => (await events(page)).some(e => e.kind === "ready")).toBe(true);
}
async function finish(page: Page, mode: string) {
  await page.evaluate(mode => (window as unknown as { __voiceProbe: Probe }).__voiceProbe.finish?.(mode), mode);
}
for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
  test.describe(`voice ${viewport.width}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 1000 });
    test("prepares silently during the answer, then plays real audio promptly and updates guidance", async ({ page }) => {
      await instrument(page); await workspace(page); await ask(page);
      expect((await events(page)).filter(e => e.kind === "playing")).toHaveLength(0);
      await finish(page, "success");
      await expect.poll(async () => (await events(page)).some(e => e.kind === "playing")).toBe(true);
      const recorded = await events(page), ready = recorded.find(e => e.kind === "ready")!, done = recorded.find(e => e.kind === "done")!, played = recorded.find(e => e.kind === "playing")!;
      expect(ready.at).toBeLessThan(done.at); expect(played.at - done.at).toBeLessThan(350);
      await expect(page.locator(".guidance-copy")).toContainText("The blue part is visible.");
      await expect(page.locator(".resizable-guidance")).toContainText("Speaking…");
      expect(recorded.filter(e => e.kind === "synthesis" && e.text === "The blue part is visible.")).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
for (const failure of ["truncated", "error"]) {
  test(`a ${failure} stream discards prepared audio and leaves guidance unmodified`, async ({ page }) => {
    await instrument(page); await workspace(page); const previous = await page.locator(".guidance-copy").innerText(); await ask(page);
    await finish(page, failure);
    await expect(page.locator(".chat-panel")).toContainText(failure === "error" ? "Test provider failed" : "Answer interrupted. Try again.");
    await page.waitForTimeout(200);
    expect((await events(page)).filter(e => e.kind === "playing")).toHaveLength(0);
    expect(await page.locator(".guidance-copy").innerText()).toBe(previous);
  });
}
test("new spoken question aborts the old prepared answer and only the latest answer plays", async ({ page }) => {
  await instrument(page); await workspace(page); await ask(page);
  await expect.poll(async () => (await events(page)).filter(e => e.kind === "listening").length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as unknown as { __voiceProbe: Probe }).__voiceProbe.ask("Hey, what is the next step?"));
  await expect.poll(async () => (await events(page)).filter(e => e.kind === "request").length).toBe(2);
  await expect.poll(async () => (await events(page)).filter(e => e.kind === "ready").length).toBe(2);
  expect((await events(page)).some(e => e.kind === "aborted")).toBe(true);
  await finish(page, "success");
  await expect.poll(async () => (await events(page)).filter(e => e.kind === "playing").length).toBe(1);
  await expect(page.locator(".chat-panel")).toContainText("Answer interrupted by a new spoken question.");
});
test("read guidance aloud uses the same AI voice and shared playback status", async ({ page }) => {
  await instrument(page); await workspace(page);
  await page.locator(".chat-panel").getByRole("button", { name: "Close chat" }).click();
  const text = await page.locator(".guidance-copy").innerText();
  await page.getByRole("button", { name: "Read guidance aloud", exact: true }).click();
  await expect.poll(async () => (await events(page)).some(e => e.kind === "playing")).toBe(true);
  expect((await events(page)).find(e => e.kind === "synthesis")!.text).toBe(text.trim());
  await expect(page.locator(".resizable-guidance")).toContainText("Speaking…");
});
test("turning voice answers off discards the pending prepared speech", async ({ page }) => {
  await instrument(page); await workspace(page);
  await page.locator(".chat-panel").getByRole("button", { name: "Listening", exact: true }).click();
  const toggle = page.locator(".chat-panel").getByRole("button", { name: "Voice answers", exact: true });
  await toggle.click();
  await page.locator(".chat-panel textarea").fill("What should I check?");
  await page.locator(".chat-panel").getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(async () => (await events(page)).some(e => e.kind === "ready" && e.text === "The blue part is visible.")).toBe(true);
  const before = (await events(page)).filter(e => e.kind === "playing").length;
  await toggle.click(); await finish(page, "success");
  await expect(page.locator(".chat-panel")).toContainText("Check the reference before moving it.");
  await page.waitForTimeout(200);
  expect((await events(page)).filter(e => e.kind === "playing")).toHaveLength(before);
});
test("changing guidance goals cancels a prepared answer before it can play", async ({ page }) => {
  await instrument(page); await workspace(page); await ask(page);
  await page.getByRole("button", { name: "Guidance goals", exact: true }).click();
  await page.getByLabel("Your wishes for this session").fill("Explain in simpler language.");
  await page.getByRole("button", { name: "Save goals" }).click();
  await expect(page.locator(".chat-panel")).toContainText("Question canceled because the input, workflow or guidance goals changed.");
  await finish(page, "success"); await page.waitForTimeout(200);
  expect((await events(page)).filter(e => e.kind === "playing")).toHaveLength(0);
});
