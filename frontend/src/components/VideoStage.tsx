import { useIsMobile } from "@/hooks/use-mobile";
import { apiFetch } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  X,
  Eye,
  EyeOff,
  FileText,
  Mic,
  MicOff,
  Ear,
  Square,
  ShieldAlert,
  SlidersHorizontal,
  Brain,
  Sparkles,
  ZoomIn,
  ZoomOut,
  Maximize,
  Monitor,
  MoreHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { setVideoAccessor } from "@/lib/frameBus";
import { useVoiceState, voiceToggle } from "@/lib/voiceBus";
import { speak, interruptAnswers } from "@/lib/speech";
import { useGeneralGuidance } from "@/lib/useGeneralGuidance";
import { useSessionMemory } from "@/lib/useSessionMemory";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ResizableGuidance } from "./ResizableGuidance";
import { GuardianMessageResize } from "@/components/GuardianMessageResize";

// Guardian and chat can use independent models for their different latency needs.
const MONITOR_MODELS: {
  display: string;
  provider: string;
  model_id: string;
  hint: string;
}[] = [
  { display: "GPT-6.1 Sol", provider: "openai", model_id: "gpt-6.1-sol", hint: "balanced vision" },
  { display: "GPT-6 Astra", provider: "openai", model_id: "gpt-6-astra", hint: "detailed vision" },
  { display: "GPT-6 Luna", provider: "openai", model_id: "gpt-6-luna", hint: "fast vision" },
  {
    display: "Claude Sonnet 4",
    provider: "anthropic",
    model_id: "claude-sonnet-4-20250514",
    hint: "detailed observations",
  },
  {
    display: "Claude Haiku 4.5",
    provider: "anthropic",
    model_id: "claude-haiku-4-5",
    hint: "compact model",
  },
  {
    display: "GPT-4o mini",
    provider: "openai",
    model_id: "gpt-4o-mini",
    hint: "fast",
  },
  {
    display: "ChatGPT-4o",
    provider: "openai",
    model_id: "gpt-4o",
    hint: "strong, slower",
  },
  {
    display: "Gemini 3 Flash",
    provider: "google",
    model_id: "gemini-3-flash-preview",
    hint: "fast (needs network)",
  },
];

export function VideoStage() {
  const a = useApp();
  const mobile = useIsMobile();
  const vref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [aiOverlay, setAiOverlay] = useState<string | null>(null);
  // Manual video zoom (1 = native size capped to the panel; >1 magnifies, clipped centrally).
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const guidanceBoundsRef = useRef<HTMLDivElement>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceUrls = useRef<string[]>([]);
  const voice = useVoiceState(); // shared "Listen" wake-word state (owned by ChatDock)
  useGeneralGuidance(); // "Process Guardian" passive safety loop (runs while monitor.active)
  useSessionMemory(); // session memory: stage milestones + rolling AI digest → Logs + prompts
  const guard = a.monitor;

  const appRef = useRef(a);
  appRef.current = a;
  useEffect(() => {
    const replay = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId: string; timeS: number }>).detail;
      const currentApp = appRef.current;
      const video = vref.current;
      if (!detail || detail.sourceId !== currentApp.sourceId || currentApp.sourceKind !== "video" || !currentApp.sourceReady || !video || !Number.isFinite(detail.timeS) || detail.timeS < 0 || !Number.isFinite(video.duration)) return;
      currentApp.setRunning(false); video.pause();
      video.currentTime = Math.min(detail.timeS, Math.max(0, video.duration - 0.001));
    };
    window.addEventListener("guidance-review-seek", replay);
    return () => window.removeEventListener("guidance-review-seek", replay);
  }, []);
  useEffect(() => {
    const video = vref.current;
    if (!video) return;
    const seeking = () => appRef.current.resetTimeline();
    const error = () =>
      appRef.current.setAnalysisError(
        "This video format cannot be played by the browser. Try MP4 (H.264) or WebM.",
      );
    video.addEventListener("seeking", seeking);
    video.addEventListener("error", error);
    return () => {
      video.removeEventListener("seeking", seeking);
      video.removeEventListener("error", error);
    };
  }, [a.videoUrl, a.liveStream]);
  useEffect(() => {
    const video = vref.current;
    if (!video) return;
    if (a.running)
      void video
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
  }, [a.running, a.videoUrl]);

  const stopVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecordingVoice(false);
  };

  const startVoiceRecording = async () => {
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, {
          type: mr.mimeType || mime || "audio/webm",
        });
        const url = URL.createObjectURL(blob);
        voiceUrls.current.push(url);
        if (voiceUrls.current.length > 10)
          URL.revokeObjectURL(voiceUrls.current.shift()!);
        toast.success("Voice note recorded", {
          description: "Play the recording from this notification.",
          action: { label: "Play", onClick: () => new Audio(url).play() },
        });
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecordingVoice(true);
      toast("Recording voice note…");
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      toast.error(
        "Voice recording could not start. Check microphone access and browser support.",
      );
    }
  };

  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
        recorder.stream.getTracks().forEach((t) => t.stop());
      }
      voiceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    const onTime = () => setCurrent(v.currentTime);
    const onMeta = () => setDuration(v.duration || 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [a.videoUrl]);

  // Live simulator stream → the main <video> via srcObject (file playback uses src).
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    if (a.liveStream) {
      v.srcObject = a.liveStream;
      v.muted = true;
      void v.play().catch(() => {
        /* resumes on first user gesture */
      });
      setPlaying(true);
    } else if (v.srcObject) {
      v.srcObject = null;
    }
  }, [a.liveStream, a.videoUrl]);

  // Expose the current frame + time to the chat (canvas capture of the <video>).
  useEffect(() => {
    const canvas = document.createElement("canvas");
    let cached: { key: string; source: HTMLVideoElement["srcObject"]; b64: string | null } | undefined;
    setVideoAccessor(() => {
      const v = vref.current;
      const durationS = Number.isFinite(v?.duration) ? (v?.duration ?? 0) : 0;
      if (!v || !v.videoWidth || v.readyState < 2 || v.seeking)
        return { b64: null, currentS: v?.currentTime ?? 0, durationS };
      try {
        const scale = Math.min(
          1,
          (appRef.current.analysis.visionDetail === "high" ||
          !appRef.current.analysis.compress
            ? 1280
            : 640) / Math.max(v.videoWidth, v.videoHeight),
        );
        const width = Math.max(1, Math.round(v.videoWidth * scale));
        const height = Math.max(1, Math.round(v.videoHeight * scale));
        const key = `${v.currentSrc}:${v.currentTime}:${width}:${height}`;
        // The sampler, Guardian and chat often request the same paused frame.
        // Reuse its JPEG and avoid resetting the canvas backing store each time.
        if (cached?.key === key && cached.source === v.srcObject)
          return { b64: cached.b64, currentS: v.currentTime, durationS, paused: v.paused };
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return { b64: null, currentS: v.currentTime, durationS };
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
        cached = { key, source: v.srcObject, b64 };
        return { b64, currentS: v.currentTime, durationS, paused: v.paused };
      } catch {
        // Cross-origin taint (needs crossOrigin + server CORS) — send time only.
        return { b64: null, currentS: v.currentTime, durationS };
      }
    });
    return () => setVideoAccessor(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input, textarea, button, [role=combobox], [contenteditable=true]",
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
      if (e.code === "ArrowLeft") step(-1);
      if (e.code === "ArrowRight") step(1);
      if (e.code === "KeyR") a.toggleRecording();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = () => {
    const v = vref.current;
    if (!v) {
      setPlaying((p) => !p);
      return;
    }
    if (v.paused) {
      v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };
  const step = (d: number) => {
    const v = vref.current;
    if (!v) return;
    v.currentTime = Math.max(
      0,
      Math.min(duration, v.currentTime + d / (a.videoFps || 30)),
    );
  };
  const seek = (t: number) => {
    const v = vref.current;
    if (v) v.currentTime = t;
  };

  const ttsGuidance = () => {
    const text = a.aiSummary?.text || a.guidance;
    if (!text) return;
    interruptAnswers();
    speak(a.apiBase, text);
  };

  // "Fit" = scale the (aspect-preserved) video until it fills the stage on one axis.
  const fitZoom = () => {
    const v = vref.current,
      c = stageRef.current;
    if (!v || !c || !v.videoWidth || !v.videoHeight) return;
    const scale0 = Math.min(
      1,
      c.clientWidth / v.videoWidth,
      c.clientHeight / v.videoHeight,
    );
    const dispW = v.videoWidth * scale0,
      dispH = v.videoHeight * scale0;
    setZoom(Math.min(c.clientWidth / dispW, c.clientHeight / dispH));
  };

  const showAi = () => {
    a.requestAnalysis();
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const frame = Math.floor(current * (a.videoFps || 30));

  const viewControls = (a.videoUrl || a.liveStream) && (
    <div className="zoom-controls-inline flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 shadow-elevated backdrop-blur">
      <button
        onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <Slider
        value={[zoom]}
        min={0.5}
        max={2.5}
        step={0.05}
        onValueChange={([v]) => setZoom(v)}
        className="w-24"
      />
      <button
        onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <span className="w-10 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <div className="h-4 w-px bg-border" />
      <button
        onClick={fitZoom}
        className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        title="Fit to panel"
      >
        <Maximize className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setZoom(1)}
        className="rounded-full px-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        title="Reset to 100%"
      >
        1:1
      </button>
    </div>
  );

  const secondaryGuidanceControls = (
    <>
      {/* Voice note mic */}
      <Button
        size="icon"
        variant={recordingVoice ? "default" : "ghost"}
        className={`h-8 w-8 ${recordingVoice ? "bg-destructive hover:bg-destructive text-destructive-foreground animate-pulse-dot" : ""}`}
        onClick={recordingVoice ? stopVoiceRecording : startVoiceRecording}
        title={recordingVoice ? "Stop voice note" : "Record voice note"}
      >
        {recordingVoice ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>

      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={ttsGuidance}
        title="Read guidance aloud · AI-generated voice"
        aria-label="Read guidance aloud"
      >
        <Volume2 className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={() => a.setShowGuidance(false)}
        title="Hide guidance"
      >
        <EyeOff className="h-4 w-4" />
      </Button>
    </>
  );

  const guidancePanel = a.showGuidance && (
    <ResizableGuidance mobile={mobile} boundsRef={mobile ? guidanceBoundsRef : stageRef}>
    <div
      className={`${mobile ? "guidance-mobile" : ""} guidance-banner w-full h-full overflow-y-auto overscroll-contain bg-card/95 backdrop-blur border border-border rounded-xl p-3 pr-12 flex flex-wrap content-start items-center gap-2 shadow-elevated`}
    >
      <Badge className="bg-primary text-primary-foreground shrink-0">
        Guidance
      </Badge>
      <div className="guidance-copy flex-1 min-w-[140px]">
        {/* The AI takeaway IS the guidance — big and readable mid-procedure. */}
        {a.aiSummary ? (
          <div
            key={a.aiSummary.ts}
            className="flex items-center gap-2 animate-slide-up min-w-0"
          >
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5">
              <Sparkles className="h-3 w-3" /> AI
            </span>
            <span className="text-base font-semibold leading-snug line-clamp-2">
              {a.aiSummary.text}
            </span>
            <button
              onClick={() => a.setAiSummary(null)}
              className="shrink-0 text-muted-foreground/60 hover:text-foreground"
              title="Dismiss AI takeaway"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{a.guidance}</p>
        )}
      </div>
      <span
        className="observation-time text-[10px] text-muted-foreground w-full"
        aria-live="polite"
      >
        {a.lastAnalysis
          ? `Observed at ${fmt(a.lastAnalysis.observed_at_s ?? 0)} · ${a.lastAnalysis.ms} ms${a.lastAnalysis.simulated ? " · demo" : ""}${a.lastAnalysis.image_quality === "unusable" ? " · view needs attention" : ""}`
          : "Waiting for the first observation"}
      </span>

      {/* Listen — real voice Q&A: say "Hey…/Hi…" then hear the answer */}
      <button
        onClick={() => {
          if (!voice.supported) {
            toast.error("Voice input needs Chrome or Edge (Web Speech API).");
            return;
          }
          voiceToggle();
          if (!voice.active)
            toast.success(
              "Listening to your workspace — say “Hey…” or “Hi…”, then just listen",
            );
        }}
        className={`relative h-9 px-3 rounded-full text-xs font-medium flex items-center gap-2 transition-all border ${
          voice.active
            ? "bg-gradient-to-r from-primary/30 to-success/30 border-primary text-foreground shadow-[0_0_18px_hsl(var(--primary)/0.45)]"
            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:border-primary/60"
        }`}
        title={
          voice.active
            ? "Stop Listen"
            : "Listen — say “Hey…” or “Hi…”, then hear the answer"
        }
      >
        {voice.active && (
          <span className="absolute inset-0 rounded-full border border-primary/60 animate-ping opacity-60" />
        )}
        {voice.speaking ? (
          <Volume2 className="h-4 w-4 relative text-primary" />
        ) : (
          <Ear
            className={`h-4 w-4 relative ${voice.active ? "text-primary" : ""}`}
          />
        )}
        <span className="relative">
          {voice.speaking ? "Speaking…" : voice.outputPhase === "preparing" ? "Preparing voice…" : voice.outputPhase === "blocked" ? "Enable sound" : voice.active ? "Listening" : "Listen"}
        </span>
        {voice.active && !voice.speaking && (
          <span className="relative flex items-end gap-0.5 h-3 ml-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-primary rounded-sm animate-pulse"
                style={{
                  height: `${40 + i * 20}%`,
                  animationDelay: `${i * 150}ms`,
                  animationDuration: "800ms",
                }}
              />
            ))}
          </span>
        )}
      </button>

      {/* Process Guardian — passive safety listener: watches the scene, speaks alerts */}
      <button
        onClick={() => {
          a.setMonitor({ active: !guard.active });
          toast(
            guard.active
              ? "Guardian off"
              : `Guardian active — ${guard.display}, target ${guard.intervalSecs}s interval`,
          );
        }}
        className={`relative h-9 px-3 rounded-full text-xs font-medium flex items-center gap-2 transition-all border ${
          guard.active
            ? "bg-primary/15 border-primary/50 text-primary"
            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground hover:border-primary/60"
        }`}
        title={
          guard.active
            ? "Stop the passive safety monitor"
            : "Guardian — passively watch the scene and speak a warning on any potential process issue"
        }
      >
        {guard.active && (
          <span className="absolute inset-0 rounded-full border border-primary/50 animate-ping opacity-50" />
        )}
        <ShieldAlert
          className={`h-4 w-4 relative ${guard.active ? "text-primary" : ""}`}
        />
        <span className="relative">
          {guard.active
            ? a.sourceReady
              ? "Observing"
              : "Waiting"
            : "Guardian"}
        </span>
      </button>

      {/* Guardian settings — passive-listener model + video processing */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            title="Guardian settings — model & video processing"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="text-xs font-semibold">
            Guardian — passive listener
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Watch model</Label>
            <Select
              value={guard.modelId}
              onValueChange={(id) => {
                const m = MONITOR_MODELS.find((x) => x.model_id === id);
                if (m)
                  a.setMonitor({
                    modelId: m.model_id,
                    provider: m.provider,
                    display: m.display,
                  });
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONITOR_MODELS.map((m) => (
                  <SelectItem
                    key={m.model_id}
                    value={m.model_id}
                    className="text-xs"
                  >
                    {m.display} · {m.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target interval · {guard.intervalSecs}s</Label>
            <Slider
              value={[guard.intervalSecs]}
              min={2}
              max={15}
              step={1}
              onValueChange={([v]) => a.setMonitor({ intervalSecs: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Video processing</Label>
            <div className="flex items-center gap-2">
              <Select
                value={guard.method}
                onValueChange={(v) =>
                  a.setMonitor({ method: v as "Frames" | "Mosaic" })
                }
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Frames" className="text-xs">
                    Frames
                  </SelectItem>
                  <SelectItem value="Mosaic" className="text-xs">
                    Mosaic
                  </SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">
                {guard.method === "Mosaic"
                  ? `${guard.mosaicN}×${guard.mosaicN} grid → 1 image`
                  : `${guard.nFrames} frames / ${guard.windowSecs}s`}
              </span>
            </div>
          </div>
          {guard.method === "Frames" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {guard.nFrames} frame(s) over {guard.windowSecs}s window
              </Label>
              <Slider
                value={[guard.nFrames]}
                min={1}
                max={9}
                step={1}
                onValueChange={([v]) => a.setMonitor({ nFrames: v })}
              />
              <Slider
                value={[guard.windowSecs]}
                min={1}
                max={8}
                step={1}
                onValueChange={([v]) => a.setMonitor({ windowSecs: v })}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Mosaic grid {guard.mosaicN}×{guard.mosaicN}
              </Label>
              <Slider
                value={[guard.mosaicN]}
                min={2}
                max={3}
                step={1}
                onValueChange={([v]) => a.setMonitor({ mosaicN: v })}
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label className="text-xs">Compress frames (faster)</Label>
            <Switch
              checked={a.analysis.compress}
              onCheckedChange={(v) => {
                a.setMonitor({ compress: v });
                a.setAnalysis({
                  compress: v,
                  visionDetail: v ? "auto" : "high",
                });
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Speak alerts (OpenAI voice)</Label>
            <Switch
              checked={guard.voiceOn}
              onCheckedChange={(v) => a.setMonitor({ voiceOn: v })}
            />
          </div>
        </PopoverContent>
      </Popover>

      {mobile ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="More guidance controls"
              className="h-10 w-10"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <p className="text-xs font-medium mb-2">Guidance controls</p>
            <div className="flex items-center gap-2">
              {secondaryGuidanceControls}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-1">
          {secondaryGuidanceControls}
        </div>
      )}
    </div>
    </ResizableGuidance>
  );

  return (
    <div ref={guidanceBoundsRef} className="video-stage h-full min-h-0 flex flex-col bg-background">
      {a.patientInfoOn && (
        <div className="border-b bg-card px-3 py-2 text-xs">
          <b>{a.workflow.title}</b>
          <span className="text-muted-foreground ml-2">
            {a.referenceName || "Visual guidance without a document"} ·{" "}
            {a.stages.length} steps
          </span>
        </div>
      )}
      {a.analysisError && (
        <div
          role="status"
          className="border-b bg-warning/10 text-warning text-xs px-3 py-2 flex items-center gap-2"
        >
          <span className="flex-1">{a.analysisError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={a.requestAnalysis}
          >
            Retry
          </Button>
        </div>
      )}

      <div
        ref={stageRef}
        className="video-canvas flex-1 min-h-0 relative bg-black grid place-items-center overflow-hidden"
      >
        {a.videoUrl || a.liveStream ? (
          <video
            ref={vref}
            src={a.liveStream ? undefined : (a.videoUrl ?? undefined)}
            crossOrigin="anonymous"
            className="max-h-full max-w-full"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
            controls={false}
            muted={!!a.liveStream}
            playsInline
          />
        ) : a.referenceFilm ? (
          <div className="max-w-md px-6 text-center text-slate-300">
            <Monitor className="mx-auto mb-4 h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="text-sm font-medium">The guide is ready for your questions</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Watch the official film above or on YouTube, then describe what you
              see in chat. Share footage you have permission to process when you
              want automatic visual checks.
            </p>
          </div>
        ) : (
          <FauxVideo playing={playing || a.running} />
        )}

        {/* Live simulator badge */}
        {a.liveStream && (
          <div
            className={`absolute left-3 ${a.running ? "top-12" : "top-3"} flex items-center gap-1.5 bg-success/90 text-success-foreground text-xs font-semibold px-2 py-1 rounded`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success-foreground animate-pulse-dot" />{" "}
            LIVE INPUT
          </div>
        )}

        {/* Live badge */}
        {a.running && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-primary/90 text-primary-foreground text-xs font-semibold px-2 py-1 rounded">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive-foreground animate-pulse-dot" />{" "}
            OBSERVING
          </div>
        )}

        {/* Guardian safety alert — banner + red ring, auto-dismissed by the hook */}
        {a.monitorAlert && (
          <>
            {a.monitorAlert.status === "alert" && (
              <div className="absolute inset-0 pointer-events-none border-4 border-destructive/70 animate-pulse z-10" />
            )}
            <GuardianMessageResize
              storageKey="guardian-message-scale"
              label="Guardian safety message"
              width={440}
              boundsRef={stageRef}
              centered
              className={`guardian-overlay absolute top-3 left-1/2 -translate-x-1/2 z-30 ${a.monitorAlert.status === "alert" ? "text-destructive-foreground" : "text-warning-foreground"}`}
            >
              <div
                className={`${a.monitorAlert.status === "alert" ? "bg-destructive" : "bg-warning"} rounded-md pl-3 pr-8 py-2 flex items-start gap-2 shadow-elevated`}
              >
                <ShieldAlert className="h-4 w-4 shrink-0 animate-pulse" />
                <span className="text-xs font-bold tracking-wide shrink-0">
                  {a.monitorAlert.status === "alert" ? "Alert" : "Review"}
                </span>
                <span className="text-sm min-w-0 break-words">
                  {a.monitorAlert.text}
                </span>
                <button
                  aria-label="Dismiss Guardian safety message"
                  onClick={() => a.setMonitorAlert(null)}
                  className="ml-1 opacity-80 hover:opacity-100 shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </GuardianMessageResize>
          </>
        )}

        {/* Guardian live "thought" pill — latest scene note; click for the thought log */}
        {guard.active &&
          !a.monitorAlert &&
          (() => {
            const last = a.guardianLog[a.guardianLog.length - 1];
            return (
              <Popover>
                <GuardianMessageResize
                  storageKey="guardian-message-scale"
                  label="Guardian message"
                  width={440}
                  boundsRef={stageRef}
                  centered
                  className="guardian-overlay absolute top-3 left-1/2 -translate-x-1/2 z-30 text-muted-foreground"
                >
                  <PopoverTrigger asChild>
                    <button
                      className="w-full flex items-start gap-2 bg-card/85 backdrop-blur border border-border hover:border-primary/60 text-xs pl-3 pr-8 py-2 rounded-md text-muted-foreground transition-colors shadow-sm text-left"
                      title="Guardian thought log — what the passive listener is seeing"
                    >
                      <span className="relative grid place-items-center shrink-0">
                        <Brain
                          className={`h-3.5 w-3.5 ${
                            a.guardianBusy
                              ? "text-primary animate-pulse"
                              : last?.status === "watch"
                                ? "text-warning"
                                : "text-success"
                          }`}
                        />
                        {a.guardianBusy && (
                          <span className="absolute inset-[-3px] rounded-full ring-1 ring-primary/40 animate-ping" />
                        )}
                      </span>
                      {/* key on ts re-triggers the slide-up animation for each new thought */}
                      <span
                        key={last?.ts ?? 0}
                        className={`flex-1 min-w-0 break-words italic animate-slide-up ${last?.status === "watch" ? "text-warning" : ""}`}
                      >
                        {a.guardianBusy && !last
                          ? "looking at the scene…"
                          : last
                            ? `“${last.text}”`
                            : a.sourceKind
                              ? "Guardian ready…"
                              : "Guardian waiting for input"}
                      </span>
                      {last && (
                        <span
                          className="shrink-0 text-[10px] font-mono opacity-60"
                          title="Video time of this observation"
                        >
                          at {Math.floor(last.videoS / 60)}:
                          {String(Math.floor(last.videoS % 60)).padStart(2, "0")}
                          <br />
                          {last.ms > 0 ? `${last.ms}ms` : "rule"}
                        </span>
                      )}
                      <span
                        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          a.guardianBusy
                            ? "bg-primary"
                            : last?.status === "watch"
                              ? "bg-warning"
                              : "bg-success"
                        } animate-pulse-dot`}
                      />
                    </button>
                  </PopoverTrigger>
                </GuardianMessageResize>
                <PopoverContent
                  align="center"
                  className="w-auto p-0 overflow-hidden"
                >
                  <GuardianMessageResize
                    storageKey="guardian-log-scale"
                    label="Guardian thought log"
                    width={420}
                    centered
                  >
                    <div className="px-3 py-2 border-b border-border flex items-center gap-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold">
                        Guardian — thought log
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {guard.display} · target {guard.intervalSecs}s
                      </span>
                      <div className="flex-1" />
                      <span className="text-[10px] text-muted-foreground">
                        {a.guardianLog.length} checks
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto scrollbar-thin pl-1.5 pr-7 py-1.5 space-y-0.5">
                      {a.guardianLog.length === 0 && (
                        <div className="text-xs text-muted-foreground px-2 py-3 text-center">
                          No checks yet — thoughts appear here as the Guardian
                          watches.
                        </div>
                      )}
                      {[...a.guardianLog].reverse().map((e) => (
                        <div
                          key={e.id}
                          className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                            e.status === "alert"
                              ? "bg-destructive/10 border border-destructive/30"
                              : e.status === "watch"
                                ? "bg-warning/10 border border-warning/30"
                                : "hover:bg-muted/40"
                          }`}
                        >
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0 mt-0.5">
                            {new Date(e.ts).toLocaleTimeString([], {
                              hour12: false,
                            })}
                          </span>
                          {e.status === "alert" ? (
                            <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                          ) : e.status === "watch" ? (
                            <Eye className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0 mt-1.5" />
                          )}
                          <span
                            className={`flex-1 min-w-0 break-words ${
                              e.status === "alert"
                                ? "text-destructive font-medium"
                                : e.status === "watch"
                                  ? "text-warning font-medium"
                                  : "text-foreground/85"
                            }`}
                          >
                            {e.text}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0 mt-0.5">
                            {e.ms > 0 ? `${e.ms}ms` : "rule"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </GuardianMessageResize>
                </PopoverContent>
              </Popover>
            );
          })()}

        {/* AI overlay answer */}
        {aiOverlay && (
          <div className="absolute top-3 right-3 max-w-sm bg-card/90 backdrop-blur border border-border rounded-md p-3 animate-slide-up">
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="shrink-0">
                AI
              </Badge>
              <p className="text-sm">{aiOverlay}</p>
              <button
                onClick={() => setAiOverlay(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {!mobile && guidancePanel}
        {!a.showGuidance && (
          <Button
            size="sm"
            variant="outline"
            className="absolute bottom-3 right-3 gap-1.5"
            onClick={() => a.setShowGuidance(true)}
          >
            <Eye className="h-3.5 w-3.5" /> Guidance
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          className="analyze-button absolute top-16 right-3 mr-0 z-40"
          onClick={showAi}
          disabled={!a.videoUrl && !a.liveStream}
          hidden={!!aiOverlay}
        >
          Analyze current view
        </Button>
      </div>

      {/* Transport — live stream has no seeking; file playback keeps full controls */}
      {mobile && guidancePanel}
      <div className="player-controls border-t border-border bg-card px-4 py-2 flex items-center gap-3 shrink-0">
        {a.referenceFilm && !a.liveStream ? (
          <p className="text-xs text-muted-foreground">Use the official film’s YouTube controls for playback.</p>
        ) : a.liveStream ? (
          <>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse-dot" />{" "}
              LIVE — {a.sourceKind === "screen" ? "shared screen" : "camera"}
            </span>
            <div className="text-xs font-mono text-muted-foreground tabular-nums">
              {fmt(current)}
            </div>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => a.stopLiveVideo()}
            >
              Stop stream
            </Button>
          </>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Previous video frame"
              onClick={() => step(-1)}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              aria-label={playing ? "Pause video" : "Play video"}
              size="icon"
              className="h-9 w-9"
              onClick={toggle}
            >
              {playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Next video frame"
              onClick={() => step(1)}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <div className="text-xs font-mono text-muted-foreground tabular-nums w-24 text-center">
              {fmt(current)} / {fmt(duration || 0)}
            </div>
            <Slider
              value={[current]}
              min={0}
              max={duration || 100}
              step={0.1}
              onValueChange={([v]) => seek(v)}
              className="video-timeline flex-1"
              aria-label="Video timeline"
            />
            <Badge
              variant="outline"
              className="frame-badge font-mono text-xs"
              title={
                a.videoFps
                  ? `Estimated frame index at ${a.videoFps.toFixed(2)} fps; variable-rate footage may differ`
                  : "Estimated frame index at 30 fps until video metadata is available"
              }
            >
              frame {frame}
            </Badge>
          </>
        )}
        {(a.videoUrl || a.liveStream) && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Video view controls"
                className="h-9 w-9 shrink-0"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <p className="text-xs font-medium p-2">Video zoom</p>
              {viewControls}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

function FauxVideo({ playing }: { playing: boolean }) {
  return (
    <div className="relative w-full h-full overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950"
        style={{ filter: playing ? "blur(0px)" : "blur(0.5px)" }}
      />
      <div
        className="absolute inset-0 opacity-30 mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(20,184,166,.25), transparent 55%)",
        }}
      />
      <div className="absolute inset-0 grid place-items-center text-center text-slate-300 text-sm">
        <div>
          <div className="text-base font-medium text-slate-100">
            Your process, in view
          </div>
          <div className="text-xs mt-1">
            Load a video or connect a camera to begin
          </div>
        </div>
      </div>
    </div>
  );
}
