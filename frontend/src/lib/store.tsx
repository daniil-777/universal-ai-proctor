import { apiFetch } from "@/lib/api";
import { initialApiBase, persistApiBase } from "./deployment";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type {
  AppMode,
  ChatMessage,
  ExperienceLevel,
  LogLine,
  MetricSpec,
  ModelOption,
  Stage,
  TaskType,
} from "./types";
import { MODELS } from "./mockData";
import { useGuidanceState } from "./guidanceState";
import { useGuidancePreferences, type GuidancePreferences } from "./useGuidancePreferences";
import type { GuidanceState } from "./guidanceState";
import { useSessionReview, type SessionReview } from "./useSessionReview";

// Live metric cards: order + labels/units/formatting for the sim classification's
// `metrics` map (keys are verbatim from the backend classifier).
const METRIC_CONFIG: {
  key: string;
  label: string;
  unit?: string;
  kind: "time" | "num" | "int";
}[] = [
  {
    key: "ExerciseDuration",
    label: "Exercise duration",
    unit: "mm:ss",
    kind: "time",
  },
  { key: "EOM Right", label: "Economy (right)", kind: "num" },
  { key: "EOM (tets)", label: "EOM (tets)", kind: "int" },
  { key: "Blood", label: "Blood emitted", unit: "ml", kind: "num" },
  { key: "Bile", label: "Bile emitted", unit: "ml", kind: "num" },
  { key: "CVS planes", label: "CVS planes", kind: "int" },
];

function fmtMetric(v: number, kind: "time" | "num" | "int"): string | number {
  if (kind === "time")
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  if (kind === "int") return Math.round(v);
  return Math.round(v * 10) / 10;
}

/** Pick the best MediaRecorder container/codec this browser supports. */
function pickRecMime(): string {
  const cands = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4",
  ];
  for (const m of cands) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported?.(m)
    )
      return m;
  }
  return "";
}

export interface AppState extends GuidanceState, GuidancePreferences, SessionReview {
  caseName: string;
  setCaseName: (s: string) => void;
  mode: AppMode;
  setMode: (m: AppMode) => void;
  model: ModelOption;
  setModel: (m: ModelOption) => void;
  experience: ExperienceLevel;
  setExperience: (e: ExperienceLevel) => void;
  task: TaskType;
  setTask: (t: TaskType) => void;
  simStatus:
    | "Disconnected"
    | "Live (MQTT)"
    | "Bundle loaded"
    | "Uploading bundle…"
    | "Loading sample bundle…"
    | "Bundle failed";
  setSimStatus: (s: AppState["simStatus"]) => void;
  stages: Stage[];
  setStages: (s: Stage[]) => void;
  currentStageId: string;
  setCurrentStageId: (id: string) => void;
  stageSource: "AI" | "Simulator";
  setStageSource: (s: "AI" | "Simulator") => void;
  simFrameRange: [number, number] | null;
  setSimFrameRange: (r: [number, number] | null) => void;
  logs: LogLine[];
  addLog: (l: LogLine) => void;
  guidance: string;
  setGuidance: (s: string) => void;
  running: boolean;
  setRunning: (b: boolean) => void;
  recording: boolean;
  setRecording: (b: boolean) => void;
  recordStart: number | null;
  toggleRecording: () => void; // real screen capture → save on stop

  chat: ChatMessage[];
  pushChat: (m: ChatMessage) => void;
  updateChat: (id: string, patch: Partial<ChatMessage>) => void;
  videoUrl: string | null;
  setVideoUrl: (s: string | null) => void;
  referenceFilm: "leica-m10" | null;
  setReferenceFilm: (film: "leica-m10" | null) => void;
  patientInfoOn: boolean;
  setPatientInfoOn: (b: boolean) => void;
  showGuidance: boolean;
  setShowGuidance: (b: boolean) => void;
  apiBase: string;
  setApiBase: (s: string) => void;
  useMock: boolean;
  setUseMock: (b: boolean) => void;
  analysis: AnalysisSettings;
  setAnalysis: (patch: Partial<AnalysisSettings>) => void;
  liveMetrics: MetricSpec[] | null;
  pushMetrics: (raw: Record<string, number>) => void;

  // Passive safety monitor ("OR Guardian")
  monitor: MonitorSettings;
  setMonitor: (patch: Partial<MonitorSettings>) => void;
  monitorAlert: MonitorAlert | null;
  setMonitorAlert: (a: MonitorAlert | null) => void;
  guardianLog: GuardianEntry[];
  pushGuardianLog: (e: GuardianEntry) => void;
  guardianBusy: boolean;
  setGuardianBusy: (b: boolean) => void;
  /** Latest RAW sim metric values (Blood, Bile, …) — ground truth for the Guardian tripwire. */
  rawMetrics: Record<string, number> | null;

  /** One-line AI takeaway of the latest Q&A answer — shown in the guidance banner. */
  aiSummary: { text: string; ts: number } | null;
  setAiSummary: (s: { text: string; ts: number } | null) => void;

  /** Live simulator video (screen/window capture or capture device) shown in the main stage.
   *  Port of the Python demo's window-capture video source (demo_window PrintWindow/mss). */
  liveStream: MediaStream | null;
  startLiveVideo: (
    source: "screen" | "camera" | { deviceId: string },
  ) => Promise<boolean>;
  stopLiveVideo: () => void;

  /** Full-prompt transparency log: what exactly was sent to the LLM per ask. */
  promptLog: PromptRecord[];
  pushPromptLog: (r: PromptRecord) => void;

  /** Session memory: deterministic stage-transition events + rolling AI digest. */
  sessionEvents: SessionEvent[];
  pushSessionEvent: (e: SessionEvent) => void;
  sessionDigest: string;
  setSessionDigest: (s: string) => void;

  /** Product intro page: shown until the operator completes onboarding. */
  introDone: boolean;
  setIntroDone: (b: boolean) => void;
  /** Sync Simulator dialog — controlled here so the intro can open it programmatically. */
  syncOpen: boolean;
  setSyncOpen: (b: boolean) => void;
}

/** One deterministic session milestone (currently: stage transitions). */
export interface SessionEvent {
  ts: number;
  videoS: number;
  type: "stage";
  text: string; // e.g. "S2 Dissection"
}

/** One Ask-AI call (typed chat or "Listen to OR") — the exact LLM input. */
export interface PromptRecord {
  id: string;
  ts: number;
  question: string;
  prompt: string; // full final prompt text sent to the model
  thumbs: string[]; // small base64 JPEGs of the frames actually attached
  usedFrames: number;
  processing: string; // sampling | mosaic | whole_video
  model: string;
  voice: boolean;
}

export interface MonitorAlert {
  status?: "watch" | "alert";
  text: string;
  ts: number;
}

/** One Guardian check = one "thought": scene note (ok), concern (watch), or warning (alert). */
export interface GuardianEntry {
  sourceId?: string;
  sourceKind?: "video" | "camera" | "screen";
  sourceName?: string;
  referenceName?: string;
  id: string;
  ts: number;
  status: "ok" | "watch" | "alert";
  text: string;
  ms: number; // check latency (0 = deterministic telemetry rule, no LLM)
  videoS?: number; // video playback time of the check — locates incidents for report clips
}

// Passive listener config — which LLM watches the scene and how frames are fed to it.
export interface MonitorSettings {
  active: boolean;
  provider: string; // "anthropic" | "openai" | "google" | "qwen"
  modelId: string;
  display: string; // model label for the UI
  intervalSecs: number; // seconds between checks
  windowSecs: number; // trailing window sampled per check
  nFrames: number; // frames per check (sampling mode)
  method: "Frames" | "Mosaic"; // distinct frames vs single mosaic image (fewer tokens)
  mosaicN: number; // mosaic grid = N×N
  compress: boolean; // 640px frames — smaller payload, faster
  voiceOn: boolean; // speak alerts through OpenAI TTS
}

const DEFAULT_MONITOR: MonitorSettings = {
  active: true,
  provider: "openai",
  modelId: "gpt-6-astra", // Highest validated recognition; alternate models remain selectable.
  display: "GPT-6 Astra",
  intervalSecs: 3,
  windowSecs: 8,
  nFrames: 9,
  method: "Frames",
  mosaicN: 2,
  compress: false,
  voiceOn: false,
};

// Shared engineering / sampling controls — the single source of truth consumed by
// both the LeftRail panel and the ChatDock so the knobs actually reach the LLM call.
export interface AnalysisSettings {
  processing: "Analyze Frame" | "Analyze Video";
  promptStyle: "Multi-stage" | "Sequential";
  windowSecs: number; // trailing window duration sampled around the current time
  intervalSecs: number; // seconds between sampled frames → drives frame COUNT
  visionDetail: "auto" | "low" | "high";
  compress: boolean; // resize each frame to 640×640
  method: "Sampling" | "Mosaic";
  mosaicN: number; // mosaic grid = N×N tiles
  tilePx: number; // mosaic tile size in px
  parallel: boolean;
  workers: number;
  injectSim: boolean;
  geminiCache: boolean;
  cropRect?: [number, number, number, number];
}

const DEFAULT_ANALYSIS: AnalysisSettings = {
  visionDetail: "high",
  processing: "Analyze Video",
  promptStyle: "Multi-stage",
  windowSecs: 8,
  intervalSecs: 1,
  compress: false,
  method: "Sampling",
  mosaicN: 3,
  tilePx: 256,
  parallel: false,
  workers: 4,
  injectSim: false,
  geminiCache: false,
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [caseName, setCaseName] = useState("Untitled guidance session");
  const [mode, setMode] = useState<AppMode>("surgeon");
  const [model, setModel] = useState<ModelOption>(MODELS[0]);
  const [experience, setExperience] = useState<ExperienceLevel>("Intermediate");
  const [task, setTask] = useState<TaskType>("Phase");
  const [simStatus, setSimStatus] =
    useState<AppState["simStatus"]>("Disconnected");
  const [stages, setStages] = useState<Stage[]>([]);
  const [currentStageId, setCurrentStageId] = useState("");
  const [stageSource, setStageSource] = useState<"AI" | "Simulator">("AI");
  const [simFrameRange, setSimFrameRange] = useState<[number, number] | null>(
    null,
  );
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [guidance, setGuidance] = useState(
    "Load a video or connect a camera to start observing the process.",
  );
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordStart, setRecordStart] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      id: "w",
      role: "assistant",
      text: "Ask about the current action, next step, or the principle behind it. Load an optional guidance document to ground the answers.",
      ts: Date.now(),
    },
  ]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [referenceFilm, setReferenceFilm] = useState<"leica-m10" | null>(null);
  const [patientInfoOn, setPatientInfoOn] = useState(false);
  const [showGuidance, setShowGuidance] = useState(true);
  // Split deployments accept a backend URL at build time. The local appliance
  // retains its same-origin API; public previews can connect through Settings.
  const [apiBase, setApiBase] = useState(initialApiBase);
  useEffect(() => persistApiBase(apiBase), [apiBase]);
  const [useMock, setUseMock] = useState(false); // call the real backend by default
  const [analysis, setAnalysisState] =
    useState<AnalysisSettings>(DEFAULT_ANALYSIS);
  const setAnalysis = useCallback(
    (patch: Partial<AnalysisSettings>) =>
      setAnalysisState((p) => ({ ...p, ...patch })),
    [],
  );
  const [monitor, setMonitorState] = useState<MonitorSettings>(DEFAULT_MONITOR);
  const setMonitor = useCallback(
    (patch: Partial<MonitorSettings>) =>
      setMonitorState((p) => ({ ...p, ...patch })),
    [],
  );
  const [monitorAlert, setMonitorAlert] = useState<MonitorAlert | null>(null);
  const [guardianLog, setGuardianLog] = useState<GuardianEntry[]>([]);
  const pushGuardianLog = useCallback(
    (e: GuardianEntry) => setGuardianLog((p) => [...p.slice(-199), e]),
    [],
  );
  const [guardianBusy, setGuardianBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<{
    text: string;
    ts: number;
  } | null>(null);

  // ── Live simulator video (getDisplayMedia window pick / getUserMedia device) ──
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);

  const cameraRecordingRef = useRef(false);
  const stopLiveVideo = useCallback(() => {
    if (cameraRecordingRef.current && recorderRef.current?.state !== "inactive")
      recorderRef.current?.stop();
    liveStreamRef.current?.getTracks().forEach((t) => t.stop());
    liveStreamRef.current = null;
    setLiveStream(null);
  }, []);

  const startLiveVideo = useCallback(
    async (
      source: "screen" | "camera" | { deviceId: string },
    ): Promise<boolean> => {
      stopLiveVideo();
      const md = navigator.mediaDevices;
      if (
        !md ||
        (source === "screen" ? !md.getDisplayMedia : !md.getUserMedia)
      ) {
        toast.error(
          "Live capture is unavailable here. Use a camera-capable browser over HTTPS or choose a video file.",
        );
        return false;
      }
      try {
        const stream =
          source === "screen"
            ? await md.getDisplayMedia({
                video: { frameRate: 30 },
                audio: false,
              })
            : await md.getUserMedia({
                video: {
                  ...(source === "camera"
                    ? { facingMode: "environment" }
                    : { deviceId: { exact: source.deviceId } }),
                  width: { ideal: 1280 },
                  frameRate: { ideal: 24, max: 30 },
                },
                audio: false,
              });
        // User pressed the browser's own "Stop sharing" bar → clear our state too.
        stream
          .getVideoTracks()[0]
          ?.addEventListener("ended", () => stopLiveVideo());
        liveStreamRef.current = stream;
        setLiveStream(stream);
        toast.success("Live video connected");
        return true;
      } catch (error) {
        const name = (error as { name?: string })?.name;
        const label = source === "screen" ? "Screen sharing" : "Camera";
        if (name === "NotAllowedError" || name === "AbortError") {
          toast.message(`${label} was not started`, { description: source === "screen" ? "Choose a screen and allow sharing, or use a video file." : "Allow camera access in your browser settings and try again, or use a video file." });
        } else {
          const detail = name === "NotFoundError" ? "No compatible camera was found. Connect a camera or choose a video file."
            : name === "NotReadableError" ? "The capture device is busy or unavailable. Close other camera apps and try again."
            : "Check your capture device and browser permissions, then try again.";
          toast.error(`${label} could not start`, { description: detail });
        }
        return false;
      }
    },
    [stopLiveVideo],
  );

  // Release capture on unmount (clears the browser's share indicator).
  useEffect(
    () => () => {
      liveStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  // Prompt transparency log — rolling last 10 asks (thumbnails are a few KB each).
  const [promptLog, setPromptLog] = useState<PromptRecord[]>([]);
  const pushPromptLog = useCallback(
    (r: PromptRecord) => setPromptLog((p) => [...p.slice(-9), r]),
    [],
  );

  // Session memory — stage milestones (capped) + constant-size rolling digest.
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const pushSessionEvent = useCallback(
    (e: SessionEvent) => setSessionEvents((p) => [...p.slice(-39), e]),
    [],
  );
  const [sessionDigest, setSessionDigest] = useState("");

  // Intro / onboarding gate + programmatic Sync Simulator dialog control.
  const [introDone, setIntroDone] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);

  // Live metric cards (driven by the sim classification during playback) + trend history.
  const [liveMetrics, setLiveMetrics] = useState<MetricSpec[] | null>(null);
  const [rawMetrics, setRawMetrics] = useState<Record<string, number> | null>(
    null,
  );
  const metricsHistRef = useRef<Record<string, number[]>>({});
  const pushMetrics = useCallback((raw: Record<string, number>) => {
    setRawMetrics(raw);
    const hist = metricsHistRef.current;
    const specs: MetricSpec[] = [];
    for (const cfg of METRIC_CONFIG) {
      const v = Number(raw[cfg.key]);
      if (!Number.isFinite(v)) continue;
      const arr = (hist[cfg.key] = [...(hist[cfg.key] ?? []), v].slice(-30));
      const tone: MetricSpec["tone"] =
        cfg.key === "Blood" || cfg.key === "Bile"
          ? v > 0.5
            ? "warning"
            : "neutral"
          : "neutral";
      specs.push({
        key: cfg.key,
        label: cfg.label,
        value: fmtMetric(v, cfg.kind),
        unit: cfg.unit,
        tone,
        trend: arr,
      });
    }
    if (specs.length) setLiveMetrics(specs);
  }, []);

  const addLog = useCallback(
    (l: LogLine) => setLogs((p) => [...p.slice(-499), l]),
    [],
  );
  const pushChat = useCallback(
    (m: ChatMessage) => setChat((p) => [...p.slice(-99), m]),
    [],
  );
  const updateChat = useCallback(
    (id: string, patch: Partial<ChatMessage>) =>
      setChat((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    [],
  );

  // ── Screen recording — high quality, with VOICE + ALL sound ──────────────────
  // Captures: the app screen (up to 1440p/60fps, 12 Mbps VP9), the microphone
  // (your voice), and the shared system/tab audio (TTS answers, Guardian alerts).
  // The two audio sources are MIXED into one track via WebAudio, because
  // MediaRecorder records a single audio track.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recAudioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startingRef = useRef(false);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }
    setRecording(false); // onstop builds + downloads the file, then clears refs
  }, []);

  const startRecording = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return;
    const md = navigator.mediaDevices;
    const directCamera = !md?.getDisplayMedia && !!liveStreamRef.current;
    if (
      (!md?.getDisplayMedia && !directCamera) ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error(
        "Connect a camera to record on this device. Screen recording requires browser screen-sharing support.",
      );
      return;
    }
    startingRef.current = true;
    if (!directCamera)
      toast.message("Recording setup", {
        description:
          "In the picker choose this tab (or the screen) and ENABLE “Share audio” so the AI voice and alerts are recorded.",
        duration: 8000,
      });

    let display: MediaStream;
    try {
      display = directCamera
        ? new MediaStream(
            liveStreamRef.current!.getTracks().map((t) => t.clone()),
          )
        : await md!.getDisplayMedia({
            video: {
              frameRate: { ideal: 60, max: 60 },
              width: { ideal: 2560 },
              height: { ideal: 1440 },
            },
            // Raw system sound — no voice processing on the TTS/alert audio.
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
    } catch {
      toast.message("Screen recording cancelled");
      startingRef.current = false;
      return;
    }
    cameraRecordingRef.current = directCamera;
    displayStreamRef.current = display;

    // Microphone (your voice) — best-effort; recording proceeds without it if denied.
    let mic: MediaStream | null = null;
    try {
      mic = await md.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch {
      toast.message("Microphone unavailable — recording without voice");
    }
    micStreamRef.current = mic;

    // Mix system audio + mic into ONE track (MediaRecorder limitation).
    const videoTrack = display.getVideoTracks()[0];
    const sysAudio = display.getAudioTracks();
    let recordStream: MediaStream = display;
    const hasAnyAudio = sysAudio.length > 0 || !!mic?.getAudioTracks().length;
    if (videoTrack && hasAnyAudio) {
      try {
        const ctx = new AudioContext({ sampleRate: 48_000 });
        recAudioCtxRef.current = ctx;
        const dest = ctx.createMediaStreamDestination();
        if (sysAudio.length)
          ctx
            .createMediaStreamSource(new MediaStream([sysAudio[0]!]))
            .connect(dest);
        if (mic?.getAudioTracks().length)
          ctx.createMediaStreamSource(mic).connect(dest);
        recordStream = new MediaStream([
          videoTrack,
          ...dest.stream.getAudioTracks(),
        ]);
      } catch {
        recordStream = display; // mixing failed — fall back to display-only audio
      }
    }
    if (!directCamera && !sysAudio.length) {
      toast.message("No system audio shared", {
        description: mic
          ? "Only your microphone will be heard. Next time tick “Share audio” in the picker to also record the AI voice."
          : "The recording will be silent. Tick “Share audio” in the picker and allow the microphone.",
        duration: 8000,
      });
    }

    const mimeType = pickRecMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(recordStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: directCamera ? 3_000_000 : 12_000_000, // high-quality 1080-1440p
        audioBitsPerSecond: 192_000,
      });
    } catch {
      toast.error("Could not start the recorder.");
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
      micStreamRef.current = null;
      startingRef.current = false;
      return;
    }
    recorderRef.current = rec;
    chunksRef.current = [];

    rec.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      cameraRecordingRef.current = false;
      setRecording(false);
      const type = rec.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      void recAudioCtxRef.current?.close().catch(() => {
        /* noop */
      });
      recAudioCtxRef.current = null;
      recorderRef.current = null;
      if (!blob.size) {
        toast.error("Recording was empty — nothing saved.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const ext = type.includes("mp4") ? "mp4" : "webm";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const link = document.createElement("a");
      link.href = url;
      link.download = `process-recording-${stamp}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Recording saved", { description: link.download });
    };

    // If the user stops sharing via the browser's own bar, finalize + save.
    display
      .getVideoTracks()[0]
      ?.addEventListener("ended", () => stopRecording());

    rec.start(1000); // flush a chunk every second so long/interrupted sessions still save
    setRecording(true);
    startingRef.current = false;
    const parts = ["screen"];
    if (sysAudio.length) parts.push("system audio");
    if (mic?.getAudioTracks().length) parts.push("microphone");
    toast.success(`Recording started — ${parts.join(" + ")}`);
  }, [stopRecording]);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current) stopRecording();
    else void startRecording();
  }, [startRecording, stopRecording]);

  // Stop capture if the app unmounts mid-recording (clears the browser share bar).
  useEffect(
    () => () => {
      try {
        recorderRef.current?.stop();
      } catch {
        /* noop */
      }
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      void recAudioCtxRef.current?.close().catch(() => {
        /* noop */
      });
    },
    [],
  );

  // Recording timer trigger
  useEffect(() => {
    if (recording) setRecordStart(Date.now());
    else setRecordStart(null);
  }, [recording]);

  const videoUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = videoUrlRef.current;
    if (previous?.startsWith("blob:") && previous !== videoUrl)
      URL.revokeObjectURL(previous);
    videoUrlRef.current = videoUrl;
  }, [videoUrl]);
  useEffect(
    () => () => {
      if (videoUrlRef.current?.startsWith("blob:"))
        URL.revokeObjectURL(videoUrlRef.current);
    },
    [],
  );
  const general = useGuidanceState({
    apiBase,
    model,
    setStages,
    setCurrentStageId,
    setGuidance,
    setVideoUrl,
    setRunning,
    setMonitorAlert,
    setAiSummary,
    stopLiveVideo,
    addLog,
    setModel,
    setMonitor,
  });

  useEffect(() => {
    if (referenceFilm && (videoUrl || (liveStream && general.sourceKind === "camera")))
      setReferenceFilm(null);
  }, [referenceFilm, videoUrl, liveStream, general.sourceKind]);

  const preferences = useGuidancePreferences(apiBase);
  const review = useSessionReview(apiBase, general.sourceId, general.sourceReady, general.revision, general.lastAnalysis);
  const value = useMemo<AppState>(
    () => ({
      ...general,
      ...preferences,
      ...review,
      caseName,
      setCaseName,
      mode,
      setMode,
      model,
      setModel,
      experience,
      setExperience,
      task,
      setTask,
      simStatus,
      setSimStatus,
      stages,
      setStages,
      currentStageId,
      setCurrentStageId,
      stageSource,
      setStageSource,
      simFrameRange,
      setSimFrameRange,
      logs,
      addLog,
      guidance,
      setGuidance,
      running,
      setRunning,
      recording,
      setRecording,
      recordStart,
      toggleRecording,
      chat,
      pushChat,
      updateChat,
      videoUrl,
      setVideoUrl,
      referenceFilm,
      setReferenceFilm,
      patientInfoOn,
      setPatientInfoOn,
      showGuidance,
      setShowGuidance,
      apiBase,
      setApiBase,
      useMock,
      setUseMock,
      analysis,
      setAnalysis,
      liveMetrics,
      pushMetrics,
      monitor,
      setMonitor,
      monitorAlert,
      setMonitorAlert,
      guardianLog,
      pushGuardianLog,
      guardianBusy,
      setGuardianBusy,
      rawMetrics,
      aiSummary,
      setAiSummary,
      liveStream,
      startLiveVideo,
      stopLiveVideo,
      promptLog,
      pushPromptLog,
      sessionEvents,
      pushSessionEvent,
      sessionDigest,
      setSessionDigest,
      introDone,
      setIntroDone,
      syncOpen,
      setSyncOpen,
    }),
    [
      general,
      review,
      preferences,
      caseName,
      mode,
      model,
      experience,
      task,
      simStatus,
      stages,
      currentStageId,
      stageSource,
      simFrameRange,
      logs,
      guidance,
      running,
      recording,
      recordStart,
      toggleRecording,
      chat,
      videoUrl,
      referenceFilm,
      patientInfoOn,
      showGuidance,
      apiBase,
      useMock,
      analysis,
      setAnalysis,
      liveMetrics,
      pushMetrics,
      addLog,
      pushChat,
      updateChat,
      monitor,
      setMonitor,
      monitorAlert,
      guardianLog,
      pushGuardianLog,
      guardianBusy,
      rawMetrics,
      aiSummary,
      liveStream,
      startLiveVideo,
      stopLiveVideo,
      promptLog,
      pushPromptLog,
      sessionEvents,
      pushSessionEvent,
      sessionDigest,
      introDone,
      syncOpen,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be inside AppProvider");
  return c;
}
