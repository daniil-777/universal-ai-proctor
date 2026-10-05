import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWakeWordListener } from "./useWakeWordListener";
const speech = vi.hoisted(() => ({ speaking: false, echo: vi.fn(() => false) }));
vi.mock("./speech", () => ({ isSpeaking: () => speech.speaking, isSpeechEcho: speech.echo }));
class Recognition {
  static all: Recognition[] = [];
  continuous = false; interimResults = false; lang = ""; maxAlternatives = 0;
  onstart: (() => void) | null = null; onspeechstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onresult: ((e: { resultIndex: number; results: ReturnType<typeof results> }) => void) | null = null;
  abort = vi.fn();
  constructor() { Recognition.all.push(this); }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
}
function results(...segments: [string, boolean][]) {
  return segments.map(([transcript, isFinal]) => ({ 0: { transcript, confidence: 1 }, length: 1, isFinal }));
}
const rec = () => Recognition.all.at(-1)!;
const emit = (segments: [string, boolean][], resultIndex = 0) => act(() => rec().onresult?.({ resultIndex, results: results(...segments) }));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
function listen(contextKey = "a") {
  const answer = vi.fn(), barge = vi.fn();
  const hook = renderHook(({ context }) => useWakeWordListener(answer, { onBargeIn: barge, contextKey: context }), { initialProps: { context: contextKey } });
  act(() => hook.result.current.start());
  return { ...hook, answer, barge };
}
beforeEach(() => {
  vi.useFakeTimers(); Recognition.all = []; speech.speaking = false; speech.echo.mockReset().mockReturnValue(false);
  Object.defineProperty(window, "SpeechRecognition", { value: Recognition, configurable: true });
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("replaces revised interim transcripts and submits once without waiting for recognizer end", async () => {
  const h = listen();
  expect(rec().continuous).toBe(true);
  emit([["Hey what co", false]]);
  emit([["Hey what color is the part", false]]);
  expect(h.result.current.question).toBe("what color is the part");
  await advance(1000); expect(h.answer).not.toHaveBeenCalled();
  emit([["Hey what color is the part?", true]]);
  await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("what color is the part?");
  act(() => rec().onend?.());
  expect(h.answer).toHaveBeenCalledTimes(1);
});
it("joins final prefixes with a revised interim suffix without duplication", async () => {
  const h = listen();
  emit([["Hey", true], ["what color", false]]);
  emit([["Hey", true], ["what color is visible?", true]], 1);
  await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("what color is visible?");
  expect(h.barge).toHaveBeenCalledTimes(1);
});
it("ignores background and accepts multiple questions in one continuous session", async () => {
  const h = listen();
  emit([["ordinary conversation", true]]);
  emit([["ordinary conversation", true], ["Hey count the parts", true]], 1);
  await advance(450);
  emit([["ordinary conversation", true], ["Hey count the parts", true], ["Hi what is next?", true]], 2);
  await advance(450);
  expect(h.answer.mock.calls).toEqual([["count the parts"], ["what is next?"]]);
  expect(Recognition.all).toHaveLength(1);
});
it("allows a short pause after a bare wake word", async () => {
  const h = listen(); emit([["Hey", true]]); await advance(900);
  emit([["Hey", true], ["explain this step", true]], 1); await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("explain this step");
});
it("expires a bare wake word so later background does not become a question", async () => {
  const h = listen(); emit([["Hey", true]]); await advance(3500);
  emit([["Hey", true], ["ordinary conversation", true]], 1); await advance(500);
  expect(h.answer).not.toHaveBeenCalled(); expect(h.result.current.question).toBe("");
});
it("keeps interim-only recognition out of submitted questions on unexpected end", async () => {
  const h = listen(); emit([["Hey what", true], ["is the hidden value", false]]);
  act(() => rec().onend?.()); await advance(200);
  expect(h.answer).not.toHaveBeenCalled(); expect(Recognition.all).toHaveLength(2);
});
it("rejects known playback echo and allows a distinct spoken interruption", async () => {
  const h = listen(); speech.speaking = true; speech.echo.mockReturnValueOnce(true).mockReturnValueOnce(true);
  emit([["Hey check the work area", true]]); await advance(450);
  expect(h.answer).not.toHaveBeenCalled(); expect(h.barge).not.toHaveBeenCalled();
  emit([["Hey check the work area", true], ["audio in the room hey what color is visible", true]], 1);
  await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("what color is visible");
  expect(h.barge).toHaveBeenCalledTimes(1);
});
it("recovers from network errors without onend and increases backoff", async () => {
  const h = listen(); act(() => rec().onerror?.({ error: "network" }));
  await advance(499); expect(Recognition.all).toHaveLength(1);
  await advance(1); expect(Recognition.all).toHaveLength(2);
  act(() => rec().onerror?.({ error: "network" }));
  await advance(999); expect(Recognition.all).toHaveLength(2);
  await advance(1); expect(Recognition.all).toHaveLength(3);
  emit([["Hey help me", true]]); await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("help me");
});
it.each(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"])("stops automatic retries for %s", async error => {
  const h = listen(); act(() => rec().onerror?.({ error })); await advance(30000);
  expect(h.result.current.active).toBe(false); expect(h.result.current.phase).toBe("error");
  expect(Recognition.all).toHaveLength(1); expect(h.result.current.error).toBeTruthy();
});
it("discard pending questions and stale callbacks when session goals change", async () => {
  const h = listen(); emit([["Hey old request", true]]); const old = rec().onresult!;
  h.rerender({ context: "new goals" });
  act(() => old({ resultIndex: 0, results: results(["Hey stale request", true]) }));
  await advance(500); expect(h.answer).not.toHaveBeenCalled();
  emit([["Hey new request", true]]); await advance(450);
  expect(h.answer).toHaveBeenCalledExactlyOnceWith("new request");
});
it("hides, pauses and stops without accepting late microphone callbacks", async () => {
  const h = listen(); emit([["Hey old request", true]]);
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  act(() => document.dispatchEvent(new Event("visibilitychange"))); await advance(500);
  expect(h.answer).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  act(() => h.result.current.pause()); await advance(1000); expect(Recognition.all).toHaveLength(2);
  act(() => h.result.current.resume()); expect(Recognition.all).toHaveLength(3);
  emit([["Hey canceled request", true]]); act(() => h.result.current.stop()); await advance(1000);
  expect(h.answer).not.toHaveBeenCalled(); expect(h.result.current.phase).toBe("idle");
});
it("bounds long continuous sessions at a finalized boundary", async () => {
  const h = listen(); const segments: [string, boolean][] = [];
  for (let i = 0; i < 48; i++) { segments.push([`Hey question ${i}`, true]); emit(segments, i); await advance(450); }
  await advance(150);
  expect(h.answer).toHaveBeenCalledTimes(48); expect(Recognition.all).toHaveLength(2);
});
