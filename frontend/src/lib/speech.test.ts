import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { speak, prepareSpeech, stopSpeech, stopNarration, interruptAnswers, isSpeaking, isSpeechEcho, getSpeechPhase, subscribeSpeech } from "./speech";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mock.fetch }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));
class AudioMock {
  static all: AudioMock[] = [];
  preload = ""; src = ""; muted = false; volume = 1;
  onended: (() => void) | null = null; onerror: (() => void) | null = null;
  play = vi.fn(async () => {}); pause = vi.fn();
  constructor() { AudioMock.all.push(this); }
}
class Utterance { onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(public text: string) {} }
const synth = { cancel: vi.fn(), speak: vi.fn() };
const create = vi.fn(() => `blob:${Math.random()}`), revoke = vi.fn();
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const response = () => new Response(new Blob(["fake audio"]), { status: 200 });
const audio = () => AudioMock.all.at(-1)!;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("Audio", AudioMock); vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  stopSpeech(); mock.fetch.mockReset(); create.mockClear(); revoke.mockClear(); synth.speak.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { stopSpeech(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("cancels pending synthesis and never creates a URL for a late canceled response", async () => {
  let resolve!: (r: Response) => void; mock.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; }));
  const end = vi.fn(); speak("", "Hey inspect the work area", { onEnd: end });
  const signal = mock.fetch.mock.calls[0][1].signal;
  interruptAnswers(); expect(signal.aborted).toBe(true); expect(end).toHaveBeenCalledTimes(1);
  resolve(response()); await flush(); expect(create).not.toHaveBeenCalled(); expect(synth.speak).not.toHaveBeenCalled(); expect(isSpeaking()).toBe(false);
});
it("filters exact audible echo while allowing a different question and releases audio on interruption", async () => {
  mock.fetch.mockImplementation(async () => response()); const end = vi.fn(); speak("", "Hey inspect the work area before continuing", { onEnd: end }); await flush();
  expect(isSpeechEcho("Hey, inspect the work area")).toBe(true); expect(isSpeechEcho("Hey what color is the tool?")).toBe(false);
  const ended = audio().onended!; interruptAnswers(); await flush();
  expect(isSpeaking()).toBe(false); expect(end).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledTimes(1);
  ended(); expect(end).toHaveBeenCalledTimes(1);
});
it("lets an alert preempt an answer and protects the alert from conversational interruptions", async () => {
  mock.fetch.mockImplementation(async () => response()); const answerEnd = vi.fn(), alertEnd = vi.fn();
  speak("", "A spoken answer about the current process", { onEnd: answerEnd }); await flush();
  speak("", "Inspect the visible concern", { priority: true, onEnd: alertEnd }); await flush();
  expect(answerEnd).toHaveBeenCalledTimes(1); interruptAnswers(); expect(isSpeaking()).toBe(true); expect(alertEnd).not.toHaveBeenCalled();
  audio().onended?.(); await flush(); expect(alertEnd).toHaveBeenCalledTimes(1); expect(isSpeaking()).toBe(false);
});
it("cancels a queued answer even during the gap before playback", async () => {
  mock.fetch.mockImplementation(async () => response()); speak("", "The first answer"); await flush(); speak("", "The stale queued answer");
  audio().onended?.(); await flush(); interruptAnswers(); await vi.advanceTimersByTimeAsync(400);
  expect(mock.fetch).toHaveBeenCalledTimes(1); expect(isSpeaking()).toBe(false);
});
it("handles synthesis failure with one fallback and permits stopping it", async () => {
  mock.fetch.mockRejectedValue(new Error("Offline")); const end = vi.fn(); speak("", "Explain the visible step", { onEnd: end }); await flush();
  expect(synth.speak).toHaveBeenCalledTimes(1); expect(isSpeaking()).toBe(true);
  stopSpeech(); expect(end).toHaveBeenCalledTimes(1); expect(isSpeaking()).toBe(false);
});
it("late synthesis from an old answer cannot revoke the new alert's audio", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; })).mockResolvedValueOnce(response());
  speak("", "Old answer"); speak("", "Current safety concern", { priority: true }); await flush();
  const currentUrl = audio().src; resolve(response()); await flush();
  expect(create).toHaveBeenCalledTimes(1); expect(revoke).not.toHaveBeenCalledWith(currentUrl); expect(isSpeaking()).toBe(true);
  stopSpeech(); expect(revoke).toHaveBeenCalledWith(currentUrl);
});
it("prepares a sentence silently and reuses it only after the confirmed answer commits", async () => {
  mock.fetch.mockImplementation(async () => response());
  const prepared = prepareSpeech("", "The blue part is visible."); await flush();
  expect(create).not.toHaveBeenCalled(); expect(getSpeechPhase()).toBe("idle");
  const start = vi.fn(); speak("", "The blue part is visible. Check the reference.", { prepared, onStart: start }); await flush();
  expect(mock.fetch.mock.calls.map(c => JSON.parse(c[1].body).text)).toEqual(["The blue part is visible.", "Check the reference."]);
  expect(getSpeechPhase()).toBe("speaking"); expect(start).toHaveBeenCalledTimes(1);
  audio().onended?.(); await flush(); expect(start).toHaveBeenCalledTimes(1);
  audio().onended?.(); await flush(); expect(getSpeechPhase()).toBe("idle");
});
it("a canceled or failed stream never allocates audio or calls browser speech", async () => {
  let resolve!: (r: Response) => void; mock.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; }));
  const controller = new AbortController(); const prepared = prepareSpeech("", "This sentence is incomplete evidence.", { signal: controller.signal });
  controller.abort(); resolve(response()); await flush(); prepared.cancel();
  expect(create).not.toHaveBeenCalled(); expect(synth.speak).not.toHaveBeenCalled(); expect(getSpeechPhase()).toBe("idle");
});
it("an already aborted owner cannot send a speculative speech request", async () => {
  const controller = new AbortController(); controller.abort();
  const prepared = prepareSpeech("", "Never speak this canceled answer.", { signal: controller.signal }); await flush(); prepared.cancel();
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
it("rejects a prepared prefix that differs from the confirmed answer", async () => {
  mock.fetch.mockImplementation(async () => response()); const prepared = prepareSpeech("", "An old observation."); await flush();
  speak("", "The confirmed answer has changed.", { prepared }); await flush();
  expect(mock.fetch.mock.calls.map(c => JSON.parse(c[1].body).text)).toEqual(["An old observation.", "The confirmed answer has changed."]);
  expect(create).toHaveBeenCalledTimes(1);
});
it("cancels silent preparation on barge-in and bounds it to one pending sentence", async () => {
  mock.fetch.mockImplementation(() => new Promise(() => {}));
  prepareSpeech("", "The older pending sentence."); const oldSignal = mock.fetch.mock.calls[0][1].signal;
  prepareSpeech("", "The latest pending sentence."); expect(oldSignal.aborted).toBe(true);
  interruptAnswers(); expect(mock.fetch.mock.calls[1][1].signal.aborted).toBe(true);
});
it("replaces an older queued answer when a new answer arrives during the gap", async () => {
  mock.fetch.mockImplementation(async () => response());
  speak("", "The first answer."); await flush(); speak("", "The stale queued answer.");
  audio().onended?.(); await flush(); speak("", "The new answer."); await flush();
  audio().onended?.(); await flush(); await vi.advanceTimersByTimeAsync(400);
  expect(mock.fetch.mock.calls.map(c => JSON.parse(c[1].body).text)).toEqual(["The first answer.", "The new answer."]);
});
it("distinguishes preparation, blocked playback, audible output and stop", async () => {
  let resolve!: (r: Response) => void; mock.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; }));
  const phases: string[] = []; const unsubscribe = subscribeSpeech(() => phases.push(getSpeechPhase())); const start = vi.fn();
  speak("", "Check the current guidance.", { onStart: start }); expect(getSpeechPhase()).toBe("preparing"); expect(start).not.toHaveBeenCalled();
  audio().play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError")); resolve(response()); await flush();
  expect(getSpeechPhase()).toBe("blocked"); expect(start).not.toHaveBeenCalled();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); await flush();
  expect(getSpeechPhase()).toBe("speaking"); expect(start).toHaveBeenCalledTimes(1);
  stopSpeech(); unsubscribe(); expect(phases).toEqual(["preparing", "blocked", "speaking", "idle"]);
});
it("a stopped prepared answer cannot cancel or replay over an alert", async () => {
  mock.fetch.mockImplementation(async () => response()); const prepared = prepareSpeech("", "This is the answer prefix."); await flush();
  speak("", "This is the answer prefix. This is the rest.", { prepared }); await flush();
  speak("", "Check the concern.", { priority: true }); await flush();
  expect(getSpeechPhase()).toBe("speaking"); expect(isSpeechEcho("Check the concern")).toBe(true);
  await vi.advanceTimersByTimeAsync(400); expect(isSpeechEcho("This is the rest")).toBe(false);
});
it("keeps prepared answer fan-out within three requests for long text", async () => {
  mock.fetch.mockImplementation(async () => response()); const prefix = "The first stable sentence is ready.";
  const prepared = prepareSpeech("", prefix); await flush();
  speak("", prefix + " " + ("Inspect the visible work area before the next documented step. ").repeat(25), { prepared }); await flush();
  expect(mock.fetch).toHaveBeenCalledTimes(3);
});
it("lets questions take the floor from narration, while narration never interrupts a question", async () => {
  mock.fetch.mockImplementation(async () => response()); const end = vi.fn();
  speak("", "A timed recap sentence.", { channel: "narration", onEnd: end }); await flush();
  speak("", "The answer to your question."); await flush(); expect(end).toHaveBeenCalledTimes(1);
  speak("", "The next timed sentence.", { channel: "narration" }); await flush();
  expect(mock.fetch).toHaveBeenCalledTimes(2); expect(isSpeechEcho("The answer to your question")).toBe(true);
  stopNarration(); expect(isSpeaking()).toBe(true);
});
it("serves queued alerts and answers before a fresh narration, and drops expired queued narration", async () => {
  mock.fetch.mockImplementation(async () => response()); let fresh = true;
  speak("", "A safety warning.", { priority: true }); await flush();
  speak("", "A low-priority recap.", { channel: "narration", isCurrent: () => fresh }); speak("", "A queued answer.");
  audio().onended?.(); await flush(); await vi.advanceTimersByTimeAsync(400);
  expect(isSpeechEcho("A queued answer")).toBe(true); fresh = false;
  audio().onended?.(); await flush(); await vi.advanceTimersByTimeAsync(400);
  expect(mock.fetch).toHaveBeenCalledTimes(2); expect(isSpeaking()).toBe(false);
});
it("never plays narration that becomes stale during synthesis", async () => {
  let resolve!: (response: Response) => void; let fresh = true;
  mock.fetch.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
  const start = vi.fn(); speak("", "Only speak at this playback position.", { channel: "narration", isCurrent: () => fresh, onStart: start });
  fresh = false; resolve(response()); await flush();
  expect(start).not.toHaveBeenCalled(); expect(isSpeaking()).toBe(false); expect(synth.speak).not.toHaveBeenCalled();
});
