import { apiFetch, sessionId } from "@/lib/api";
import { appRoute } from "@/lib/deployment";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ExternalLink,
  Image as ImageIcon,
  MessageSquare,
  SlidersHorizontal,
  Send,
  Maximize2,
  Minimize2,
  Volume2,
  X,
  Ear,
} from "lucide-react";
import { useApp } from "@/lib/store";
import {
  recentFrameSamples,
  bufferFrame,
  sampleVideoOverview,
  grabFrame,
} from "@/lib/frameBus";
import { useWakeWordListener } from "@/lib/useWakeWordListener";
import { registerVoiceControl, publishVoiceState } from "@/lib/voiceBus";
import {
  speak,
  prepareSpeech,
  interruptAnswers,
  stopSpeech,
  subscribeSpeech,
  getSpeechPhase,
} from "@/lib/speech";
import type { PreparedSpeech } from "@/lib/speech";
import { firstSpeechSentence } from "@/lib/speechText";
import { buildHistoryBlock } from "@/lib/sessionHistory";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Size = "dock" | "drawer" | "full";

const QUICK = [
  "What is visible in this frame?",
  "What's my next step?",
  "Explain the current step",
  "What needs attention?",
];

export function ChatDock({ embedded = false }: { embedded?: boolean }) {
  const a = useApp();
  const requests = useRef(new Set<AbortController>());
  const contextKey = `${a.sourceId}:${a.revision}:${a.timelineEpoch}:${a.preferencesRevision}`;
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const questionGeneration = useRef(0);
  const voiceRequest = useRef<AbortController | null>(null);
  const pendingSpeech = useRef<PreparedSpeech | null>(null);
  useEffect(
    () => () => {
      for (const controller of requests.current) controller.abort();
      requests.current.clear();
      stopSpeech();
    },
    [contextKey],
  );
  const [open, setOpen] = useState(embedded);
  const [size, setSize] = useState<Size>(embedded ? "full" : "dock");
  const [text, setText] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [tts, setTts] = useState(false);
  const ttsEnabled = useRef(tts);
  ttsEnabled.current = tts;
  const [scope, setScope] = useState<"Whole video" | "Sampling">("Sampling");
  const speechPhase = useSyncExternalStore(
    subscribeSpeech,
    getSpeechPhase,
    getSpeechPhase,
  );
  const speaking = speechPhase === "speaking";
  const scrollRef = useRef<HTMLDivElement>(null);
  // Lets the wake-word listener call the latest send() without a definition cycle.
  const sendRef = useRef<(q: string, opts?: { voice?: boolean }) => void>(
    () => {},
  );

  // Estimated frames sent to the model per query (drives, and mirrors, the engineering panel).
  const estFrames =
    a.analysis.method === "Mosaic"
      ? a.analysis.mosaicN * a.analysis.mosaicN
      : Math.max(
          1,
          Math.round(a.analysis.windowSecs / a.analysis.intervalSecs),
        );

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [a.chat.length]);

  // "Listen" — always-on wake-word mic. Each utterance that starts with
  // "Hey…"/"Hi…" is captured on the natural pause and answered by voice.
  // BARGE-IN: saying "Hey…" while an answer is being spoken cuts the audio
  // immediately (conversational interrupt); safety alerts are never cut.
  const listener = useWakeWordListener(
    (q) => {
      // Don't force the chat open — voice can be driven heads-down from the guidance
      // bar ("just talk and hear the answer"). The answer still streams into the chat
      // log and is spoken via TTS whether the panel is open or not.
      sendRef.current(q, { voice: true });
    },
    {
      onBargeIn: () => {
        interruptAnswers();
        questionGeneration.current++;
        voiceRequest.current?.abort("voice-interrupt");
      },
      contextKey,
    },
  );

  const toggleListen = () => {
    if (!listener.supported) {
      toast.error(
        "Voice input needs a browser with speech recognition support.",
      );
      return;
    }
    listener.toggle();
  };
  useEffect(() => {
    if (!open || embedded) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setOpen(false);
    };
    panelRef.current
      ?.querySelector<HTMLButtonElement>('[aria-label="Close chat"]')
      ?.focus();
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      const target = previous?.isConnected
        ? previous
        : document.querySelector<HTMLButtonElement>('[aria-label="Open chat"]');
      if (target && !target.closest("[inert]")) target.focus();
    };
  }, [open, embedded]);

  // Expose the listener to the guidance-bar "Listen" button via the voice bus.
  // The shared speech channel keeps wake-word barge-in active; echo filtering
  // excludes known audible output. Pause/resume remain available to callers.
  useEffect(() => {
    registerVoiceControl({
      toggle: listener.toggle,
      start: listener.start,
      stop: listener.stop,
      pause: listener.pause,
      resume: listener.resume,
    });
    return () => registerVoiceControl(null);
  }, [
    listener.toggle,
    listener.start,
    listener.stop,
    listener.pause,
    listener.resume,
  ]);
  useEffect(() => {
    publishVoiceState({
      active: listener.active,
      speaking,
      outputPhase: speechPhase,
      supported: listener.supported,
    });
  }, [listener.active, speaking, speechPhase, listener.supported]);
  const PHASE_LABEL: Record<string, string> = {
    listening: "Listening…",
    hearing: "Hearing you — pause when you're done",
    armed: "Got it — capturing your question",
    error: "Voice input error",
    idle: "",
  };

  // All guidance, alerts and answers share one output channel. The wake-word
  // listener remains available for barge-in and filters the app's own speech.

  // Smart one-line takeaway of the finished answer → guidance banner (fire-and-forget).
  const summarizeToGuidance = async (
    q: string,
    answer: string,
    context: string,
    generation: number,
  ) => {
    try {
      const res = await apiFetch(`${a.apiBase}/api/llm/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: answer, question: q }),
      });
      const j = (await res.json()) as { ok?: boolean; summary?: string };
      if (
        latestContext.current === context &&
        questionGeneration.current === generation &&
        j.ok &&
        j.summary
      )
        a.setAiSummary({ text: j.summary, ts: Date.now() });
    } catch {
      /* non-critical — banner just keeps the previous content */
    }
  };

  const send = async (override?: string, opts?: { voice?: boolean }) => {
    const voice = opts?.voice ?? false;
    const t = (override ?? text).trim();
    if (!t) return;
    if (!a.preferencesReady) {
      toast.error(
        a.preferencesError ||
          "Session goals are loading. Try again in a moment.",
      );
      return;
    }
    const context = contextKey;
    const generation = ++questionGeneration.current;
    pendingSpeech.current?.cancel();
    pendingSpeech.current = null;
    interruptAnswers();
    const current = () => latestContext.current === context;
    const latestQuestion = () =>
      current() && questionGeneration.current === generation;
    const id = crypto.randomUUID();
    a.pushChat({ id, role: "user", text: t, ts: Date.now() });
    setText("");
    const aid = crypto.randomUUID();
    a.pushChat({
      id: aid,
      role: "assistant",
      text: "",
      ts: Date.now(),
      streaming: true,
    });
    const speakIt = voice || tts; // voice questions always spoken; typed only when speaker on
    const wantsSpeech = () => speakIt && (voice || ttsEnabled.current);

    // ── Mock mode: local fake stream ──
    if (a.useMock) {
      const reply =
        "Demo mode is enabled. No video analysis was performed. Disable demo mode to ask the configured AI provider about your process.";
      let i = 0;
      const iv = setInterval(() => {
        if (!current()) {
          clearInterval(iv);
          a.updateChat(aid, {
            streaming: false,
            text: "Question canceled because the input, workflow or guidance goals changed.",
          });
          return;
        }
        i += 4;
        a.updateChat(aid, { text: reply.slice(0, i) });
        if (i >= reply.length) {
          clearInterval(iv);
          a.updateChat(aid, { streaming: false, text: reply });
          if (wantsSpeech() && latestQuestion()) speak(a.apiBase, reply);
          // Mock mode: local first-sentence takeaway (no backend round-trip).
          const first = reply.split(/(?<=[.!?])\s/)[0] ?? reply;
          if (latestQuestion())
            a.setAiSummary({
              text: first.length > 110 ? first.slice(0, 107) + "…" : first,
              ts: Date.now(),
            });
        }
      }, 15);
      return;
    }

    // ── Real mode: stream tokens from the backend as the model generates them ──
    if (voice) voiceRequest.current?.abort("voice-interrupt");
    const controller = new AbortController();
    if (voice) voiceRequest.current = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 60000);
    requests.current.add(controller);
    let prepared: PreparedSpeech | undefined;
    let committed = false;
    try {
      const grab = grabFrame(); // current on-screen frame + playback time
      bufferFrame(grab);
      const samples = recentFrameSamples(
        a.analysis.windowSecs,
        Math.min(
          9,
          Math.max(
            1,
            Math.round(a.analysis.windowSecs / a.analysis.intervalSecs),
          ),
        ),
      );
      let requestFrames = samples.map((sample) => sample.b64);
      let requestTimes = samples.map((sample) => sample.currentS);
      if (!requestFrames.length && grab.b64) requestFrames = [grab.b64];
      if (!requestTimes.length && grab.b64) requestTimes = [grab.currentS];
      // Source-owned upload/sample readiness is authoritative; blob playback URLs
      // can still have a server copy, while URL prefixes alone do not prove one.
      const serverSide = a.sourceKind === "video" && a.serverVideoReady;
      const EXP_MAP = {
        Beginner: "beginner",
        Intermediate: "middle",
        Expert: "expert",
      } as const;
      // Answer LENGTH follows the level too: beginners get detailed teaching (4-5
      // sentences), experts get terse peer-level replies (2-3). Voice mode overrides
      // to concise server-side regardless.
      const STYLE_MAP = {
        Beginner: "advanced",
        Intermediate: "middle",
        Expert: "concise",
      } as const;
      const processing =
        scope === "Whole video"
          ? "whole_video"
          : a.analysis.method === "Mosaic"
            ? "mosaic"
            : "sampling";
      const nSamples = Math.min(
        9,
        Math.max(
          1,
          Math.round(a.analysis.windowSecs / a.analysis.intervalSecs),
        ),
      );
      if (scope === "Whole video" && a.videoUrl && !serverSide) {
        try {
          requestFrames = await sampleVideoOverview(
            a.videoUrl,
            5,
            (times) => {
              requestTimes = times;
            },
            controller.signal,
          );
        } catch {
          /* Current frame fallback. */
        }
      }

      controller.signal.throwIfAborted();
      const res = await apiFetch(`${a.apiBase}/api/llm/ask/stream`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: t,
          provider: a.model.provider,
          model_id: a.model.model_id,
          processing,
          chunk_secs: a.analysis.windowSecs,
          window_s: a.analysis.windowSecs,
          n_samples: nSamples,
          compress: a.analysis.compress,
          vision_detail: a.analysis.visionDetail,
          mosaic_n: a.analysis.mosaicN,
          tile_px: a.analysis.tilePx,
          experience_level: EXP_MAP[a.experience],
          style: STYLE_MAP[a.experience],
          current_s: grab.currentS,
          frames_b64: serverSide ? undefined : requestFrames,
          source_id: a.sourceId,
          revision: a.revision,
          preferences_revision: a.preferencesRevision,
          frame_times_s: serverSide ? undefined : requestTimes,
          crop_rect: a.analysis.cropRect,
          voice: speakIt, // spoken-friendly answers for both voice and speaker-enabled chat
          // Compact PAST context: stage path, incidents, rolling digest, recent Q&A.
          history_block:
            buildHistoryBlock({
              sessionEvents: a.sessionEvents,
              guardianLog: a.guardianLog,
              chat: a.chat,
              sessionDigest: a.sessionDigest,
            }) || undefined,
        }),
      });
      if (!current() || controller.signal.aborted)
        throw new DOMException("Canceled", "AbortError");
      if (!res.ok || !res.body) {
        const error = await res.json().catch(() => ({}));
        if (
          res.status === 409 &&
          String(error.error).includes("Guidance goals changed")
        )
          void a.refreshPreferences();
        throw new Error(error.error || `Request failed (HTTP ${res.status})`);
      }

      type SsePayload = {
        delta?: string;
        error?: string;
        detail?: string;
        done?: boolean;
        used_frames?: number;
        prompt?: string;
        thumbs_b64?: string[];
      };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      let errored = false;
      let completed = false;
      let lastRender = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (!current() || controller.signal.aborted) {
          await reader.cancel().catch(() => {});
          throw new DOMException("Canceled", "AbortError");
        }
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let payload: SsePayload;
          try {
            payload = JSON.parse(line.slice(5).trim()) as SsePayload;
          } catch {
            continue;
          }
          if (payload.delta) {
            full += payload.delta;
            if (!prepared && !errored && wantsSpeech() && latestQuestion()) {
              const sentence = firstSpeechSentence(full);
              if (sentence) {
                prepared = prepareSpeech(a.apiBase, sentence, {
                  signal: controller.signal,
                });
                pendingSpeech.current = prepared;
              }
            }
            if (performance.now() - lastRender > 50) {
              a.updateChat(aid, { text: full });
              lastRender = performance.now();
            }
          } else if (payload.error) {
            errored = true;
            full = `⚠ ${payload.error}${payload.detail ? ": " + payload.detail : ""}`;
            a.updateChat(aid, { text: full });
          } else if (payload.done) {
            completed = true;
            a.addLog({
              ts: Date.now(),
              level: "info",
              source: "Prompt",
              msg: `Ask → ${payload.used_frames ?? 0} frame(s) · ${processing}${processing === "mosaic" ? ` (${a.analysis.mosaicN}×${a.analysis.mosaicN})` : ""}${speakIt ? " · voice" : ""} — full prompt in the Prompt tab`,
            });
            // Full transparency record: the exact prompt + previews of the frames sent.
            if (payload.prompt) {
              a.pushPromptLog({
                id: crypto.randomUUID(),
                ts: Date.now(),
                question: t,
                prompt: payload.prompt,
                thumbs: payload.thumbs_b64 ?? [],
                usedFrames: payload.used_frames ?? 0,
                processing,
                model: a.model.display,
                voice: speakIt,
              });
            }
          }
        }
      }
      if (!completed && !errored) {
        errored = true;
        full = `${full}${full ? "\n\n" : ""}⚠ Answer interrupted. Try again.`;
      }
      a.updateChat(aid, { streaming: false, text: full || "(empty answer)" });
      if (!errored && full && wantsSpeech() && latestQuestion()) {
        speak(a.apiBase, full, { prepared });
        committed = true;
      }
      if (!errored && full && latestQuestion())
        void summarizeToGuidance(t, full, context, generation);
    } catch (e) {
      a.updateChat(aid, {
        streaming: false,
        text:
          controller.signal.aborted || !current()
            ? controller.signal.reason === "voice-interrupt"
              ? "Answer interrupted by a new spoken question."
              : controller.signal.reason === "timeout"
                ? "The answer timed out. Try again."
                : "Question canceled because the input, workflow or guidance goals changed."
            : `⚠ Could not reach backend at ${a.apiBase} — ${String(e)}`,
      });
    } finally {
      if (!committed) prepared?.cancel();
      if (pendingSpeech.current === prepared) pendingSpeech.current = null;
      clearTimeout(timeout);
      if (voiceRequest.current === controller) voiceRequest.current = null;
      requests.current.delete(controller);
    }
  };
  sendRef.current = send;

  if (!open && !embedded) {
    return (
      <Button
        aria-label="Open chat"
        onClick={() => setOpen(true)}
        className="chat-launcher fixed bottom-5 right-5 h-12 w-12 rounded-full shadow-elevated z-40 p-0"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    );
  }

  const containerCls = embedded
    ? "h-full w-full"
    : size === "full"
      ? "fixed inset-4 z-40"
      : size === "drawer"
        ? "fixed right-0 top-14 bottom-0 w-[440px] z-40"
        : "fixed bottom-5 right-5 w-[400px] h-[560px] z-40";

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="AI Assistant"
      data-embedded={embedded}
      data-chat-size={size}
      data-options-open={optionsOpen}
      className={`${containerCls} chat-panel bg-card border border-border rounded-lg shadow-elevated flex flex-col overflow-hidden animate-slide-up`}
    >
      <div className="chat-header min-h-14 border-b border-border px-3 flex items-center gap-2 shrink-0">
        <div className="h-7 w-7 rounded-md bg-primary/15 grid place-items-center">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div className="text-sm font-medium">AI Assistant</div>
        <Badge variant="outline" className="text-[10px]">
          {a.model.display}
        </Badge>
        <div className="flex-1" />
        {!embedded && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() =>
                window.open(
                  appRoute(`/share/${sessionId()}`),
                  "_blank",
                  "width=520,height=720",
                )
              }
              aria-label="Pop out chat"
              title="Pop out for screen-share"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label="Change chat size"
              onClick={() =>
                setSize((s) =>
                  s === "dock" ? "drawer" : s === "drawer" ? "full" : "dock",
                )
              }
            >
              {size === "full" ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              aria-label="Close chat"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        className="chat-history flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-3 space-y-3 break-words"
      >
        {a.chat.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {m.role === "assistant" ? (
              <div className="max-w-[85%]">
                <div className="text-sm whitespace-pre-wrap">
                  {m.text || (
                    <span className="animate-typing">
                      <span>●</span>
                      <span>●</span>
                      <span>●</span>
                    </span>
                  )}
                </div>
                {m.frames && (
                  <div className="flex gap-1.5 mt-1.5">
                    {m.frames.map((f, i) => (
                      <div
                        key={i}
                        className="h-12 w-16 rounded border border-border bg-gradient-to-br from-slate-800 to-teal-950 grid place-items-center text-[9px] text-muted-foreground"
                      >
                        {f}
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  {new Date(m.ts).toLocaleTimeString()}
                </div>
              </div>
            ) : (
              <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm">
                {m.text}
                <div className="text-[10px] opacity-70 mt-0.5">
                  {new Date(m.ts).toLocaleTimeString()}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-composer border-t border-border px-3 py-2 shrink-0">
        {!listener.active && listener.error && (
          <p
            role="alert"
            className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {listener.error}
          </p>
        )}
        {listener.active && (
          <div className="chat-listener mb-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5 animate-slide-up">
            <div className="flex items-center gap-2.5">
              <div className="relative grid place-items-center h-8 w-8 rounded-full bg-primary/15 shrink-0">
                <Ear className="h-4 w-4 text-primary" />
                <span className="absolute inset-0 rounded-full ring-2 ring-primary/40 animate-ping" />
              </div>
              <div className="flex items-end gap-0.5 h-5" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-primary/70 animate-pulse"
                    style={{
                      height: `${8 + (i % 3) * 6}px`,
                      animationDelay: `${i * 120}ms`,
                      animationDuration: "900ms",
                      opacity: listener.phase === "listening" ? 0.5 : 1,
                    }}
                  />
                ))}
              </div>
              <div className="text-xs font-medium text-primary truncate">
                {speaking
                  ? "🔊 Speaking — say “Hey…” to interrupt"
                  : speechPhase === "preparing"
                    ? "Preparing voice…"
                    : speechPhase === "blocked"
                      ? "Click anywhere to hear the AI voice"
                      : PHASE_LABEL[listener.phase] || "Listening…"}
              </div>
              <div className="flex-1" />
              <button
                onClick={listener.stop}
                className="text-[11px] text-muted-foreground hover:text-foreground shrink-0"
              >
                Stop
              </button>
            </div>

            <div className="mt-2 min-h-[1.75rem]">
              {listener.phase === "armed" ? (
                <div className="rounded-lg bg-card border border-primary/30 px-2.5 py-1.5 text-sm shadow-sm animate-slide-up">
                  <span className="text-primary/60 mr-0.5">“</span>
                  {listener.question}
                  <span className="text-primary/60 ml-0.5">”</span>
                </div>
              ) : listener.interim ? (
                <div className="text-sm text-muted-foreground italic line-clamp-2">
                  {listener.interim}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Say <span className="text-primary font-medium">“Hey…”</span>{" "}
                  or <span className="text-primary font-medium">“Hi…”</span> to
                  ask — I capture the question when you pause.
                </div>
              )}
            </div>
            {listener.error && (
              <div className="mt-1 text-[11px] text-destructive">
                {listener.error}
              </div>
            )}
          </div>
        )}

        <div className="chat-extra flex flex-wrap gap-1.5 mb-2">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="text-[11px] px-2 py-1 rounded-full border border-border hover:bg-muted/40"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="chat-input-row flex items-end gap-2">
          <Textarea
            aria-label="Message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about this process, the next step, or visible concerns…"
            rows={2}
            className="resize-none text-sm flex-1 min-w-0"
          />
          <Button
            aria-label="Send message"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={() => send()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="chat-actions flex items-center gap-2 mt-2">
          <Button
            variant={listener.active ? "default" : "outline"}
            onClick={toggleListen}
            aria-pressed={listener.active}
            className="h-9 gap-1.5 px-2.5"
            title="Start your question with Hey or Hi, then pause for an answer."
          >
            <Ear className="h-4 w-4" />
            {listener.active ? "Listening" : "Listen"}
          </Button>
          <Button
            size="icon"
            variant={tts ? "default" : "outline"}
            className="h-9 w-9"
            aria-label="Voice answers"
            aria-pressed={tts}
            title={`${tts ? "Voice answers: on" : "Voice answers: off"} · AI-generated voice`}
            onClick={() => {
              const enabled = !tts;
              setTts(enabled);
              if (enabled) speak(a.apiBase, "Voice answers on.", {});
              else {
                pendingSpeech.current?.cancel();
                interruptAnswers();
              }
            }}
          >
            <Volume2 className="h-4 w-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label="Reference images"
                size="icon"
                variant="outline"
                className="h-9 w-9"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2">
              <Label className="text-xs">Conditioned image</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {["ref1", "ref2", "ref3"].map((r) => (
                  <button
                    key={r}
                    className="h-14 rounded border border-border bg-muted/40 grid place-items-center text-[10px] hover:border-primary"
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" className="w-full">
                Upload new
              </Button>
            </PopoverContent>
          </Popover>
          <div className="flex-1" />
          <Button
            aria-label="Chat options"
            aria-expanded={optionsOpen}
            aria-controls="chat-sampling-options"
            size="icon"
            variant={optionsOpen ? "secondary" : "ghost"}
            className="chat-options-toggle h-9 w-9"
            onClick={() => setOptionsOpen((value) => !value)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <div
          id="chat-sampling-options"
          className="chat-extra chat-scope flex flex-wrap items-center gap-2 mt-2 text-[11px]"
        >
          <Label className="text-[11px] text-muted-foreground">Scope</Label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as "Whole video" | "Sampling")}
          >
            <SelectTrigger
              aria-label="Question scope"
              className="h-8 w-[120px] text-[11px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Whole video">Whole video</SelectItem>
              <SelectItem value="Sampling">Sampling</SelectItem>
            </SelectContent>
          </Select>
          {scope === "Sampling" && (
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-muted-foreground whitespace-nowrap">
                window {a.analysis.windowSecs}s · ~{estFrames}f
              </span>
              <Slider
                value={[a.analysis.windowSecs]}
                min={1}
                max={10}
                step={1}
                onValueChange={([v]) => a.setAnalysis({ windowSecs: v })}
                aria-label="Question sampling window"
                className="flex-1"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
