import { apiFetch } from "./api";
import { spokenText } from "./speechText";
// speech.ts — the app's single shared TTS output channel (OpenAI voice via /api/tts,
// browser speechSynthesis as a LAST-resort fallback), with a professional utterance
// QUEUE, autoplay-proof playback, and sentence-pipelined synthesis for fast starts.
//
// Arbitration rules:
//   • An utterance that has STARTED is never cut off by another utterance.
//     The one exception: a safety ALERT may preempt a spoken chat ANSWER
//     (safety first) — but an alert NEVER preempts another alert, and an
//     answer never preempts anything.
//   • While something is playing, new arrivals are QUEUED per channel with
//     LATEST-WINS replacement (no backlog of stale warnings).
//   • Queued alerts are served before queued answers, with a short natural gap.
//   • A new alert with the SAME text as the one currently speaking is dropped.
//   • BARGE-IN: the OR wake-word mic stays LIVE during playback (the wake-word
//     gate filters out the transcribed TTS audio); saying "Hey…" mid-answer calls
//     interruptAnswers() so the user can speak over the assistant like in a real
//     conversation. Safety ALERTS are never cut off by barge-in.
//
// Latency: silently prepare a stable first sentence during answer generation.
// Commit after a successful stream, then play sentence chunks in order while
// the remainder synthesizes. Timings depend on the provider and connection.
//
// Playback strategy: ONE persistent <audio> element, unlocked on the first user
// gesture. If play() is blocked (autoplay policy / muted site), we do NOT degrade
// to the robotic voice — we hold the OpenAI audio, tell the user, and play it on
// the next click/keypress. speechSynthesis is reserved for genuine TTS failures.

import { toast } from "sonner";

export interface SpeakOpts {
  voice?: string; // omit to use the server's configured voice
  priority?: boolean; // true = safety-alert channel
  prepared?: PreparedSpeech;
  onStart?: () => void;
  onEnd?: () => void; // fires on natural end AND if preempted/stopped
}

type Channel = "alert" | "answer";

interface Utterance {
  apiBase: string;
  text: string;
  voice?: string;
  channel: Channel;
  prepared?: PreparedSpeech;
  started?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

const GAP_MS = 350; // natural breath between consecutive utterances
const CHUNK_TARGET = 180; // aim ≤ this many chars per TTS request
const MAX_CHUNKS = 3; // cap request fan-out; remainder merges into the last

export type SpeechPhase = "idle" | "preparing" | "blocked" | "speaking";
let phase: SpeechPhase = "idle";
const subscribers = new Set<() => void>();
export const getSpeechPhase = (): SpeechPhase => phase;
export function subscribeSpeech(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
function setPhase(value: SpeechPhase): void {
  if (phase === value) return;
  phase = value;
  subscribers.forEach(fn => fn());
}

/** Silent synthesis during answer generation, committed only on success. No
 * object URL exists until playback owns it. Keep one speculative request. */
export interface PreparedSpeech { readonly text: string; cancel: () => void }
interface Preparation {
  apiBase: string;
  voice?: string;
  controller: AbortController;
  audio: Promise<Blob>;
  claimed: boolean;
  unlink: () => void;
}
const preparations = new Map<PreparedSpeech, Preparation>();
export function prepareSpeech(apiBase: string, text: string, opts: { voice?: string; signal?: AbortSignal } = {}): PreparedSpeech {
  for (const [handle, state] of preparations) if (!state.claimed) handle.cancel();
  const controller = new AbortController();
  const handle: PreparedSpeech = {
    text: spokenText(text),
    cancel: () => {
      controller.abort();
      preparations.get(handle)?.unlink();
      preparations.delete(handle);
    },
  };
  const abort = () => handle.cancel();
  opts.signal?.addEventListener("abort", abort, { once: true });
  if (opts.signal?.aborted) controller.abort();
  const state: Preparation = {
    apiBase, voice: opts.voice, controller, claimed: false,
    unlink: () => opts.signal?.removeEventListener("abort", abort),
    audio: fetchTtsBlob(apiBase, handle.text, opts.voice, controller),
  };
  preparations.set(handle, state);
  state.audio.catch(() => {});
  if (opts.signal?.aborted) handle.cancel();
  return handle;
}

// 44-byte silent WAV used to unlock the audio element inside a real user gesture.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

let gen = 0; // bumped by stopSpeech() — invalidates in-flight playback
let playing = false;
let currentItem: Utterance | null = null;
let currentUtter: SpeechSynthesisUtterance | null = null;
let ttsController: AbortController | null = null;
let cancelPlayback: (() => void) | null = null;
let audibleText = "";
let recentEcho = { text: "", until: 0 };
let activeUrls: string[] = []; // object URLs owned by the current utterance
// One pending slot per channel — latest wins, no backlog.
let nextAlert: Utterance | null = null;
let nextAnswer: Utterance | null = null;
let gapTimer: number | undefined;

// ── Shared, gesture-unlocked audio element ────────────────────────────────────
let sharedEl: HTMLAudioElement | null = null;
let unlocked = false;
let gestureRetry: (() => void) | null = null; // blocked playback → resume on next gesture

function audioEl(): HTMLAudioElement {
  if (!sharedEl) {
    sharedEl = new Audio();
    sharedEl.preload = "auto";
  }
  return sharedEl;
}

function handleGesture(): void {
  const retry = gestureRetry;
  gestureRetry = null;
  if (!unlocked) {
    unlocked = true;
    // Prime the element inside the gesture so later programmatic play() succeeds
    // (element-based unlock — required on Safari, harmless on Chrome/Edge).
    if (!playing) {
      const el = audioEl();
      try {
        el.muted = true;
        el.src = SILENT_WAV;
        void el
          .play()
          .then(() => {
            if (!playing && el.src === SILENT_WAV) el.pause();
            el.muted = false;
          })
          .catch(() => {
            el.muted = false;
          });
      } catch {
        el.muted = false;
      }
    }
  }
  retry?.();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", handleGesture, true);
  window.addEventListener("keydown", handleGesture, true);
}

// ── Public API ────────────────────────────────────────────────────────────────
export function speak(
  apiBase: string,
  text: string,
  opts: SpeakOpts = {},
): void {
  const t = spokenText(text);
  if (!t) { opts.prepared?.cancel(); return; }
  const item: Utterance = {
    apiBase,
    text: t,
    voice: opts.voice,
    channel: opts.priority ? "alert" : "answer",
    prepared: opts.prepared,
    onStart: opts.onStart,
    onEnd: opts.onEnd,
  };

  if (!playing) {
    clearTimeout(gapTimer);
    gapTimer = undefined;
    if (item.channel === "answer") {
      discard(nextAnswer); nextAnswer = null;
      if (nextAlert) {
        nextAnswer = item;
        const alert = nextAlert; nextAlert = null;
        void playNow(alert);
        return;
      }
    } else { discard(nextAlert); nextAlert = null; }
    void playNow(item);
    return;
  }

  if (item.channel === "alert") {
    if (currentItem?.channel === "alert") {
      // Never interrupt a warning being spoken; queue the newest (no echo).
      if (currentItem.text !== item.text) { discard(nextAlert); nextAlert = item; }
      else discard(item);
      return;
    }
    // Safety first: an alert may preempt a chat ANSWER (never another alert).
    preemptCurrent();
    void playNow(item);
    return;
  }

  // Answers always wait their turn (latest wins).
  discard(nextAnswer); nextAnswer = item;
}

function discard(item: Utterance | null): void {
  item?.prepared?.cancel();
  item?.onEnd?.();
}

/** Hard stop (user action): clears the queue and silences everything. */
export function stopSpeech(): void {
  gen++;
  clearTimeout(gapTimer);
  gapTimer = undefined;
  discard(nextAlert); nextAlert = null;
  discard(nextAnswer); nextAnswer = null;
  for (const handle of preparations.keys()) handle.cancel();
  gestureRetry = null;
  preemptCurrent();
}

/** Output ownership includes synthesis/autoplay waits so barge-in can cancel them. */
export function isSpeaking(): boolean {
  return playing;
}

/** Conservative text echo filter; unrelated user questions remain eligible. */
export function isSpeechEcho(text: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const heard = normalize(text);
  if (heard.split(" ").length < 3) return false;
  const own = normalize(audibleText || (Date.now() < recentEcho.until ? recentEcho.text : ""));
  return !!own && ` ${own} `.includes(` ${heard} `);
}

/**
 * BARGE-IN: the user started a new "Hey…" question while an ANSWER was speaking —
 * silence it (and any queued answer) so they can talk. A safety ALERT in progress
 * is deliberately NOT interrupted; it finishes first.
 */
export function interruptAnswers(): void {
  discard(nextAnswer); nextAnswer = null;
  for (const [handle, state] of preparations) if (!state.claimed) handle.cancel();
  if (currentItem?.channel === "answer") {
    preemptCurrent();
    scheduleNext(); // serve a queued alert if one exists
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

function releaseUrls(): void {
  for (const u of activeUrls) URL.revokeObjectURL(u);
  activeUrls = [];
}

/** Stop the current utterance WITHOUT serving the queue (caller decides what's next). */
function preemptCurrent(): void {
  gestureRetry = null; // a held-for-gesture playback is now stale
  ttsController?.abort();
  ttsController = null;
  cancelPlayback?.();
  cancelPlayback = null;
  if (audibleText) recentEcho = { text: audibleText, until: Date.now() + 1200 };
  audibleText = "";
  if (sharedEl) {
    sharedEl.onended = null;
    sharedEl.onerror = null;
    try {
      sharedEl.pause();
    } catch {
      /* noop */
    }
  }
  releaseUrls();
  if (currentUtter) {
    currentUtter.onend = null;
    currentUtter.onerror = null;
    currentUtter = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const item = currentItem;
  item?.prepared?.cancel();
  currentItem = null;
  playing = false;
  setPhase("idle");
  item?.onEnd?.(); // let the interrupted owner reset its UI state
}

/** Split into sentence chunks so the first audio starts fast. */
function splitForTts(text: string): string[] {
  if (text.length <= CHUNK_TARGET + 40) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (
      cur &&
      (cur.length + s.length + 1 > CHUNK_TARGET ||
        chunks.length === MAX_CHUNKS - 1)
    ) {
      if (chunks.length < MAX_CHUNKS - 1) {
        chunks.push(cur);
        cur = s;
      } else {
        cur = `${cur} ${s}`;
      } // last chunk absorbs the remainder
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

async function fetchTtsBlob(apiBase: string, text: string, voice: string | undefined, controller: AbortController): Promise<Blob> {
  if (controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await apiFetch(`${apiBase}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`tts HTTP ${res.status}`);
    const blob = await res.blob();
    if (controller.signal.aborted) throw new DOMException("Canceled", "AbortError");
    return blob;
  } finally { clearTimeout(timer); }
}

function ownAudio(blob: Blob, item: Utterance, controller: AbortController): string {
  if (controller.signal.aborted || currentItem !== item) throw new DOMException("Canceled", "AbortError");
  const url = URL.createObjectURL(blob);
  activeUrls.push(url);
  return url;
}

function markAudible(item: Utterance, text: string): void {
  if (currentItem !== item) return;
  audibleText = text;
  setPhase("speaking");
  if (!item.started) { item.started = true; item.onStart?.(); }
}

/** Play one mp3 URL on the shared element; resolves on ended, holds through autoplay blocks. */
function playOneUrl(
  url: string,
  myGen: number,
  item: Utterance,
  text: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const el = audioEl();
    const settle = () => { if (cancelPlayback === settle) cancelPlayback = null; resolve(); };
    cancelPlayback = settle;
    el.onended = settle;
    el.onerror = () => {
      if (cancelPlayback === settle) cancelPlayback = null;
      reject(
        new Error(`audio element error: ${el.error?.message ?? "unknown"}`),
      );
    };
    el.muted = false;
    el.volume = 1;
    el.src = url;
    const start = () => el.play().then(() => {
      if (myGen === gen && currentItem === item) markAudible(item, text);
    });
    start().catch((err: DOMException) => {
      if (myGen !== gen || currentItem !== item) {
        resolve();
        return;
      }
      if (err?.name === "NotAllowedError") {
        setPhase("blocked");
        // Autoplay / site sound blocked: hold the audio, replay on the next gesture.
        console.warn(
          "speech: play() blocked by the browser — will start on the next click/keypress",
        );
        toast.message("🔊 Click anywhere to hear the voice", {
          description:
            "The browser blocked audio. Click or press a key, then check your browser's sound permission and device volume.",
          duration: 10000,
        });
        gestureRetry = () => {
          if (myGen !== gen || currentItem !== item) return;
          start().catch((e2) =>
            reject(e2 instanceof Error ? e2 : new Error(String(e2))),
          );
        };
        return; // resolve comes via onended after the gesture retry
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/** Robotic browser voice — LAST resort, only for genuine TTS failures. */
function fallbackSynth(text: string, finish: () => void): void {
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    currentUtter = u;
    u.onend = finish;
    u.onerror = () => finish();
    const item = currentItem;
    u.onstart = () => { if (item) markAudible(item, text); };
    window.speechSynthesis.speak(u);
  } else {
    finish();
  }
}

async function playNow(item: Utterance): Promise<void> {
  const myGen = gen;
  playing = true; // set synchronously so concurrent speak() calls queue correctly
  currentItem = item;
  setPhase("preparing");
  const controller = new AbortController();
  ttsController = controller;
  // NOTE: the wake-word mic intentionally stays LIVE during playback (barge-in);
  // the wake-word gate drops whatever the recognizer hears of our own TTS.

  const finish = () => {
    if (myGen !== gen || currentItem !== item) return; // stopped or preempted
    controller.abort();
    item.prepared?.cancel();
    if (ttsController === controller) ttsController = null;
    if (audibleText) recentEcho = { text: audibleText, until: Date.now() + 1200 };
    audibleText = "";
    releaseUrls();
    currentUtter = null;
    currentItem = null;
    playing = false;
    setPhase("idle");
    item.onEnd?.();
    scheduleNext();
  };
  const aborted = () => myGen !== gen || currentItem !== item;

  // Sentence pipeline: kick off ALL chunk fetches in parallel, play in order.
  const prepared = item.prepared && preparations.get(item.prepared);
  const prefix = item.prepared?.text || "";
  const usable = prepared && !prepared.controller.signal.aborted &&
    prepared.apiBase === item.apiBase && prepared.voice === item.voice &&
    (item.text === prefix || item.text.startsWith(prefix + " "));
  let chunks: string[];
  let fetches: Promise<string>[];
  if (usable) {
    prepared.claimed = true;
    prepared.unlink(); // the speech queue now owns cancellation
    controller.signal.addEventListener("abort", () => item.prepared?.cancel(), { once: true });
    const rest = item.text.slice(prefix.length).trim();
    const remaining = rest ? splitForTts(rest) : [];
    if (remaining.length > MAX_CHUNKS - 1) remaining.splice(1, remaining.length - 1, remaining.slice(1).join(" "));
    chunks = [prefix, ...remaining];
    fetches = [prepared.audio.then(blob => ownAudio(blob, item, controller)),
      ...remaining.map(c => fetchTtsBlob(item.apiBase, c, item.voice, controller).then(blob => ownAudio(blob, item, controller)))];
  } else {
    item.prepared?.cancel();
    chunks = splitForTts(item.text);
    fetches = chunks.map(c => fetchTtsBlob(item.apiBase, c, item.voice, controller).then(blob => ownAudio(blob, item, controller)));
  }
  // Surface late rejections of not-yet-awaited fetches (avoids unhandled rejections).
  for (const f of fetches)
    f.catch(() => {
      /* handled when awaited in order */
    });

  let i = 0;
  try {
    for (; i < chunks.length; i++) {
      const url = await fetches[i];
      if (aborted()) return;
      await playOneUrl(url, myGen, item, chunks[i]);
      if (aborted()) return;
    }
    finish();
  } catch (err) {
    if (aborted()) return;
    controller.abort();
    releaseUrls();
    const remaining = chunks.slice(i).join(" ");
    console.warn("speech: OpenAI voice failed → speechSynthesis fallback", err);
    toast.error("OpenAI voice failed — using the browser voice", {
      description: err instanceof Error ? err.message : String(err),
      duration: 8000,
    });
    fallbackSynth(remaining, finish);
  }
}

/** Serve the queue: alerts first, with a short natural gap. */
function scheduleNext(): void {
  if (!nextAlert && !nextAnswer) return;
  clearTimeout(gapTimer);
  const myGen = gen;
  gapTimer = window.setTimeout(() => {
    gapTimer = undefined;
    if (myGen !== gen || playing) return;
    const item = nextAlert ?? nextAnswer;
    if (!item) return;
    if (nextAlert) nextAlert = null;
    else nextAnswer = null;
    void playNow(item);
  }, GAP_MS);
}
