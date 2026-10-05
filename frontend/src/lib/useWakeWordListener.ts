// Continuous wake-word listener with indexed transcript assembly and guarded recovery.
import { useCallback, useEffect, useRef, useState } from "react";
import { stripWakeWord, findWakeWordAnywhere } from "./wakeWord";
import { isSpeaking, isSpeechEcho } from "./speech";

// ── Minimal typings for the Web Speech API (absent from the TS DOM lib) ──────────
interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  readonly length: number;
  isFinal: boolean;
  [i: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { readonly length: number; [i: number]: SRResult };
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SRInstance;

function getCtor(): SRCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export type ListenPhase = "idle" | "listening" | "hearing" | "armed" | "error";

export interface WakeWordListener {
  supported: boolean;
  active: boolean;
  phase: ListenPhase;
  interim: string; // live raw transcript for the current utterance
  question: string; // stripped question preview once a wake word is heard
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  /** Temporarily stop capturing (e.g. while the spoken answer plays) without ending the session. */
  pause: () => void;
  /** Resume capturing after pause(), if the loop is still active. */
  resume: () => void;
}

// Result lists are indexed snapshots, not append-only text. Consume each final
// question once while keeping the recognizer open between questions.
const FINAL_SETTLE_MS = 450;
const RESTART_MS = 150;
const MAX_RECOVERY_MS = 8000;

export function useWakeWordListener(
  onQuestion: (q: string) => void,
  opts?: { onBargeIn?: () => void; contextKey?: string },
): WakeWordListener {
  const [supported] = useState(() => getCtor() !== null);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<ListenPhase>("idle");
  const [interim, setInterim] = useState("");
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const generation = useRef(0);
  const failures = useRef(0);
  const restartRef = useRef<ReturnType<typeof setTimeout>>();
  const finalizeRef = useRef<ReturnType<typeof setTimeout>>();
  const onQuestionRef = useRef(onQuestion);
  onQuestionRef.current = onQuestion;
  const onBargeInRef = useRef(opts?.onBargeIn);
  onBargeInRef.current = opts?.onBargeIn;
  const launchRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    clearTimeout(restartRef.current);
    clearTimeout(finalizeRef.current);
  }, []);
  const detach = useCallback(() => {
    generation.current++;
    clearTimers();
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onstart = rec.onspeechstart = rec.onresult = rec.onerror = rec.onend = null;
      try { rec.abort(); } catch { /* already ended */ }
    }
  }, [clearTimers]);

  const launch = useCallback(() => {
    if (!activeRef.current || pausedRef.current || document.hidden) return;
    const Ctor = getCtor();
    if (!Ctor) return;
    detach();
    const ticket = generation.current;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let bareWakeAt: number | undefined;
    let segments: { text: string; final: boolean }[] = [];
    let consumed = 0;
    let armed = false;
    let lenient = false;
    let failed = false;
    let retryDelay = RESTART_MS;
    const valid = () => ticket === generation.current && recRef.current === rec && activeRef.current && !pausedRef.current && !document.hidden;
    const resetPreview = () => { armed = lenient = false; setInterim(""); setQuestion(""); };
    const extract = (text: string) => stripWakeWord(text) ?? ((lenient || isSpeaking()) ? findWakeWordAnywhere(text) : null);
    const finalize = () => {
      clearTimeout(finalizeRef.current);
      if (!valid() || failed) return;
      const pending = segments.slice(consumed);
      // Interim hypotheses are preview only. Never submit an incomplete suffix.
      if (!pending.length || pending.some(s => !s.final)) return;
      const text = pending.map(s => s.text).join(" ").trim();
      const q = isSpeechEcho(text) ? null : extract(text);
      if (q === "") {
        // Allow a short pause after the wake word, then release the gate so later
        // background conversation cannot become an accidental question.
        bareWakeAt ??= Date.now();
        if (Date.now() - bareWakeAt < 3000) {
          finalizeRef.current = setTimeout(finalize, 3000 - (Date.now() - bareWakeAt));
          return;
        }
      }
      bareWakeAt = undefined;
      consumed = segments.length;
      resetPreview();
      setPhase("listening");
      failures.current = 0;
      if (q) onQuestionRef.current(q);

    };
    rec.onstart = () => { if (valid()) { setError(null); setPhase("listening"); } };
    rec.onspeechstart = () => { if (valid()) { clearTimeout(finalizeRef.current); setPhase(armed ? "armed" : "hearing"); } };
    rec.onresult = (e) => {
      if (!valid() || failed) return;
      clearTimeout(finalizeRef.current);
      failures.current = 0;
      segments.length = e.results.length;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        segments[i] = { text: r[0]?.transcript.trim() || "", final: r.isFinal };
      }
      // Drop finalized background utterances before a new wake word. Existing
      // armed questions keep their following segments, even without another wake.
      while (!armed && consumed < segments.length && segments[consumed]?.final) {
        const text = segments[consumed].text;
        if (!isSpeechEcho(text) && extract(text) !== null) break;
        consumed++;
      }
      const pending = segments.slice(consumed).filter(Boolean);
      const text = pending.map(s => s.text).join(" ").trim();
      const q = isSpeechEcho(text) ? null : extract(text);
      setInterim(text);
      if (q !== null) {
        if (!armed) {
          lenient = stripWakeWord(text) === null && isSpeaking();
          armed = true;
          onBargeInRef.current?.();
        }
        setQuestion(q);
        setPhase("armed");
      } else {
        setQuestion("");
        setPhase(text ? "hearing" : "listening");
      }
      if (pending.length && pending.every(s => s.final))
        finalizeRef.current = setTimeout(() => {
          finalize();
          // Bound transcript history only after a question is fully consumed.
          if (valid() && consumed === segments.length && segments.length >= 48) {
            detach();
            restartRef.current = setTimeout(() => launchRef.current(), RESTART_MS);
          }
        }, FINAL_SETTLE_MS);
    };
    const fail = (err: string) => {
      failed = true;
      clearTimeout(finalizeRef.current);
      resetPreview();
      if (["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"].includes(err)) {
        activeRef.current = false;
        setActive(false);
        setError(err.includes("allowed") ? "Microphone permission was blocked. Allow it in the browser and try again." : err === "audio-capture" ? "Microphone unavailable. Check the connected microphone and try again." : "The speech service does not support this language.");
        setPhase("error");
        detach();
        return;
      }
      failures.current++;
      retryDelay = Math.min(MAX_RECOVERY_MS, 500 * 2 ** Math.min(4, failures.current - 1));
      setError(err === "network" ? "Speech service unreachable. Retrying with backoff…" : `Speech recognition interrupted (${err}). Retrying…`);
      setPhase("error");
      // Some engines omit onend after an error; recovery must not depend on it.
      restartRef.current = setTimeout(() => { if (valid()) launchRef.current(); }, retryDelay);
    };
    rec.onerror = (ev) => {
      if (!valid()) return;
      if (ev.error === "no-speech") {
        failures.current = 0; segments = []; consumed = 0; resetPreview(); return;
      }
      if (ev.error === "aborted") { fail("aborted"); return; }
      fail(ev.error || "unknown");
    };
    rec.onend = () => {
      if (!valid()) return;
      if (!failed) finalize();
      recRef.current = null;
      clearTimers();
      if (!failed) setPhase("listening");
      restartRef.current = setTimeout(() => launchRef.current(), retryDelay);
    };
    setInterim(""); setQuestion("");
    try { rec.start(); } catch { fail("start-failed"); }
  }, [detach, clearTimers]);
  launchRef.current = launch;

  const start = useCallback(() => {
    if (!supported || activeRef.current) return;
    activeRef.current = true;
    pausedRef.current = false;
    failures.current = 0;
    setActive(true); setError(null);
    launch();
  }, [supported, launch]);
  const stop = useCallback(() => {
    activeRef.current = false; pausedRef.current = false;
    detach(); setActive(false); setPhase("idle"); setInterim(""); setQuestion("");
  }, [detach]);
  const pause = useCallback(() => {
    pausedRef.current = true;
    detach(); setPhase("idle"); setInterim(""); setQuestion("");
  }, [detach]);
  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    if (activeRef.current) launch();
  }, [launch]);
  const toggle = useCallback(() => { (activeRef.current ? stop : start)(); }, [start, stop]);
  useEffect(() => {
    const visibility = () => {
      detach(); setInterim(""); setQuestion("");
      if (!document.hidden && activeRef.current && !pausedRef.current) launch();
      else if (activeRef.current) setPhase("idle");
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { activeRef.current = false; detach(); document.removeEventListener("visibilitychange", visibility); };
  }, [detach, launch]);
  useEffect(() => {
    // Do not finish a partly recognized question against a changed source/goals.
    detach(); setInterim(""); setQuestion("");
    if (activeRef.current && !pausedRef.current) launch();
  }, [opts?.contextKey, detach, launch]);
  return { supported, active, phase, interim, question, error, start, stop, toggle, pause, resume };
}
