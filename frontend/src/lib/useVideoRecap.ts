import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
import { downloadReport } from "./reportShare";
import { speak, stopNarration } from "./speech";
import { parseVideoSummaryJob, recapHasResult, recapIsActive, videoSummaryPlanSchema, type DomainKey, type RecapMode, type VideoSummaryJob, type VideoSummaryPlan } from "./videoSummaryTypes";

interface Inputs {
  apiBase: string; sourceId: string; sourceReady: boolean; serverVideoReady: boolean;
  sourceKind: string | null; definitionKey: string; preferencesRevision: number;
  useMock: boolean; provider: string; modelId: string;
}
export interface RecapPlayback { sourceId: string; timeS: number; playing: boolean; seeking?: boolean; ended?: boolean }
export function narrationWindow(job: VideoSummaryJob | null, time: number, floor = -1) {
  return job?.windows.filter(window => window.status === "complete" && !!window.narration.trim() && window.end_s <= time && window.end_s > floor && time - window.end_s <= Math.min(6, Math.max(2, window.end_s - window.start_s))).sort((a, b) => b.end_s - a.end_s)[0];
}

export function useVideoRecap(inputs: Inputs) {
  const latestInputs = useRef(inputs); latestInputs.current = inputs;
  const context = JSON.stringify([inputs.apiBase, inputs.sourceId, inputs.definitionKey, inputs.preferencesRevision, inputs.sourceKind]);
  const contextRef = useRef(context); contextRef.current = context;
  const eligible = inputs.sourceKind === "video" && inputs.sourceReady && inputs.serverVideoReady && !inputs.useMock;
  // A workflow seek temporarily clears sourceReady while resetting progress.
  // It does not change the uploaded media or this immutable recap's inputs.
  const narrationEligible = inputs.sourceKind === "video" && inputs.serverVideoReady && !inputs.useMock;
  const [job, setJob] = useState<VideoSummaryJob | null>(null);
  const stateContext = useRef(context);
  const ownedJob = stateContext.current === context && job?.source.id === inputs.sourceId ? job : null;
  const [plan, setPlan] = useState<VideoSummaryPlan | null>(null);
  const ownedPlan = stateContext.current === context && plan?.source_id === inputs.sourceId ? plan : null;
  const [open, setOpen] = useState(false);
  const [mode, setModeState] = useState<RecapMode>("detailed");
  const [domainOverride, setDomainOverride] = useState<DomainKey | "auto">("auto");
  const [includeAudio, setIncludeAudio] = useState(false);
  const [narrationEnabled, setNarrationState] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<"start" | "cancel" | "retry" | "download" | null>(null);
  const [error, setError] = useState("");
  const [narratingWindow, setNarratingWindow] = useState<string | null>(null);
  const [awaitingSummary, setAwaitingSummary] = useState(false);
  const [releasedJobId, setReleasedJobId] = useState<string | null>(null);
  const current = useRef({ job: ownedJob, narrationEnabled, eligible: narrationEligible }); current.current = { job: ownedJob, narrationEnabled, eligible: narrationEligible };
  const requests = useRef(new Set<AbortController>());
  const operation = useRef(false);
  const jobGeneration = useRef(0);
  const activeNarration = useRef<string | null>(null);
  const playback = useRef<RecapPlayback>({ sourceId: inputs.sourceId, timeS: 0, playing: false });
  const playbackBackend = useRef(inputs.apiBase);
  const spoken = useRef(new Set<string>());
  const narrationFloor = useRef(-1);
  const endedSource = useRef<string | null>(null);
  const planGeneration = useRef(0);

  const request = useCallback(async <T,>(route: string, consume: (response: Response) => Promise<T>, init: RequestInit = {}) => {
    const owner = context;
    const controller = new AbortController(); requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await apiFetch(`${inputs.apiBase}${route}`, { ...init, signal: controller.signal });
      if (controller.signal.aborted || contextRef.current !== owner) throw new DOMException("Inputs changed", "AbortError");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || (response.status === 404 ? "Video recap is unavailable on this backend. Connect to an updated backend." : `Video recap request failed (${response.status}).`));
      }
      const data = await consume(response);
      if (controller.signal.aborted || contextRef.current !== owner) throw new DOMException("Inputs changed", "AbortError");
      return data;
    } finally { clearTimeout(timer); requests.current.delete(controller); }
  }, [context, inputs.apiBase]);

  const accept = useCallback((value: unknown) => {
    const next = parseVideoSummaryJob(value);
    if (next.source.id !== latestInputs.current.sourceId) throw new Error("The video changed. Start a new recap.");
    setJob(previous => previous?.id === next.id && previous.updated_at > next.updated_at ? previous : next);
    setError("");
    return next;
  }, []);

  const refresh = useCallback(async () => {
    if (!eligible) return;
    const owner = context; const generation = jobGeneration.current;
    try {
      const data = await request<{ ok: boolean; job: unknown }>("/api/video-summary/jobs/current", response => response.json());
      if (contextRef.current !== owner || generation !== jobGeneration.current) return;
      if (!data?.ok) throw new Error("The backend returned an invalid video recap response.");
      if (data.job === null) setJob(null); else accept(data.job);
    } catch (reason) { if (contextRef.current === owner && (reason as Error).name !== "AbortError") setError((reason as Error).message); }
  }, [eligible, context, request, accept]);

  const loadPlan = useCallback(async (nextMode: RecapMode = mode) => {
    if (!eligible) return;
    const owner = context; const generation = ++planGeneration.current;
    setPlanLoading(true); setPlan(null);
    try {
      const data = await request<{ ok: boolean; plan: unknown }>(`/api/video-summary/plan?mode=${nextMode}`, response => response.json());
      if (contextRef.current !== owner || generation !== planGeneration.current) return;
      const parsed = videoSummaryPlanSchema.safeParse(data.plan);
      if (!data.ok || !parsed.success || parsed.data.source_id !== inputs.sourceId || parsed.data.mode !== nextMode) throw new Error("The backend returned an invalid recap plan.");
      setPlan(parsed.data); setError("");
    } catch (reason) { if (contextRef.current === owner && generation === planGeneration.current && (reason as Error).name !== "AbortError") setError((reason as Error).message); }
    finally { if (contextRef.current === owner && generation === planGeneration.current) setPlanLoading(false); }
  }, [context, eligible, inputs.sourceId, mode, request]);

  const openRecap = useCallback(() => { setOpen(true); void refresh(); void loadPlan(); }, [loadPlan, refresh]);
  const setMode = (value: RecapMode) => { setModeState(value); void loadPlan(value); };
  const setNarrationEnabled = useCallback((value: boolean) => {
    current.current.narrationEnabled = value;
    setNarrationState(value); stopNarration(); setNarratingWindow(null);
    spoken.current.clear(); activeNarration.current = null; narrationFloor.current = playback.current.timeS - 0.01;
  }, []);
  const resumeGuidance = () => {
    if (!ownedJob || recapIsActive(ownedJob) || operation.current) return;
    setReleasedJobId(ownedJob.id);
    setNarrationEnabled(false);
  };

  const notifyPlayback = useCallback((clock: RecapPlayback) => {
    if (clock.sourceId !== latestInputs.current.sourceId || !Number.isFinite(clock.timeS)) return;
    playback.current = clock;
    if (clock.seeking || !clock.playing || clock.ended) { stopNarration(); activeNarration.current = null; setNarratingWindow(null); }
    if (clock.seeking) { narrationFloor.current = clock.timeS - 0.01; spoken.current.clear(); }
    if (clock.ended && current.current.job) {
      endedSource.current = clock.sourceId;
      if (recapHasResult(current.current.job)) { setOpen(true); setAwaitingSummary(false); endedSource.current = null; }
      else if (recapIsActive(current.current.job)) setAwaitingSummary(true);
    }
    if (!clock.playing || clock.seeking || clock.ended || !current.current.narrationEnabled) return;
    const activeJob = current.current.job;
    const window = narrationWindow(activeJob, clock.timeS, narrationFloor.current);
    if (!window || !activeJob) { stopNarration(); activeNarration.current = null; setNarratingWindow(null); return; }
    if (activeNarration.current && activeNarration.current !== window.id) { stopNarration(); activeNarration.current = null; }
    if (spoken.current.has(window.id)) return;
    spoken.current.add(window.id); activeNarration.current = window.id;
    const owner = contextRef.current;
    const valid = () => contextRef.current === owner && current.current.eligible && current.current.narrationEnabled && playback.current.sourceId === activeJob.source.id && playback.current.playing && !playback.current.seeking && !playback.current.ended && narrationWindow(current.current.job, playback.current.timeS, narrationFloor.current)?.id === window.id;
    speak(latestInputs.current.apiBase, window.narration, { channel: "narration", isCurrent: valid, onStart: () => { if (valid()) setNarratingWindow(window.id); }, onEnd: () => setNarratingWindow(previous => previous === window.id ? null : previous) });
  }, []);

  useEffect(() => {
    const controllers = requests.current;
    stateContext.current = context;
    setJob(null); setPlan(null); setError(""); setActionBusy(null); setPlanLoading(false); setNarrationState(false); setNarratingWindow(null); setAwaitingSummary(false);
    setReleasedJobId(null);
    operation.current = false; jobGeneration.current++; spoken.current.clear(); activeNarration.current = null; endedSource.current = null;
    if (playback.current.sourceId !== inputs.sourceId || playbackBackend.current !== inputs.apiBase) playback.current = { sourceId: inputs.sourceId, timeS: 0, playing: false };
    playbackBackend.current = inputs.apiBase; narrationFloor.current = playback.current.timeS - 0.01;
    stopNarration(); setDomainOverride("auto"); setIncludeAudio(false);
    return () => { controllers.forEach(controller => controller.abort()); controllers.clear(); stopNarration(); };
  }, [context, inputs.sourceId, inputs.apiBase]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!narrationEligible) { stopNarration(); setNarrationState(false); activeNarration.current = null; setNarratingWindow(null); } }, [narrationEligible]);
  useEffect(() => { notifyPlayback(playback.current); }, [job, narrationEnabled, notifyPlayback]);
  useEffect(() => {
    if (endedSource.current === inputs.sourceId && recapHasResult(job)) { endedSource.current = null; setAwaitingSummary(false); setOpen(true); }
    if (job && ["failed", "stale", "cancelled"].includes(job.status)) { setAwaitingSummary(false); endedSource.current = null; }
  }, [job, inputs.sourceId]);
  const starting = actionBusy === "start" || actionBusy === "retry";
  const active = eligible && (recapIsActive(ownedJob) || starting);
  const guidanceResumed = !!ownedJob && releasedJobId === ownedJob.id && !recapIsActive(ownedJob);
  const ownsUploadedAnalysis = inputs.sourceKind === "video" && ((!!ownedJob && !guidanceResumed) || (eligible && starting));
  useEffect(() => {
    if (!active) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(() => void poll(), 1500); };
    timer = setTimeout(() => void poll(), 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active, job?.id, refresh]);

  const perform = async (kind: "start" | "cancel" | "retry") => {
    if (operation.current || !eligible || (kind === "start" && !plan) || (kind !== "start" && !job)) return;
    jobGeneration.current++;
    if (kind === "start" || kind === "retry") setReleasedJobId(null);
    operation.current = true; setActionBusy(kind); setError("");
    const owner = context;
    try {
      const route = kind === "start" ? "/api/video-summary/jobs" : `/api/video-summary/jobs/${encodeURIComponent(job!.id)}/${kind}`;
      const body = kind === "start" ? { source_id: inputs.sourceId, reference_key: plan!.reference_key, mode, provider: inputs.provider, model_id: inputs.modelId, ...(domainOverride === "auto" ? {} : { domain_override: domainOverride }), include_audio: includeAudio } : {};
      const data = await request<{ ok: boolean; job: unknown }>(route, response => response.json(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (contextRef.current !== owner) return;
      if (!data.ok) throw new Error("The backend returned an invalid job response.");
      accept(data.job);
      if (kind === "start") { spoken.current.clear(); narrationFloor.current = playback.current.timeS - 0.01; }
    } catch (reason) { if (contextRef.current === owner && (reason as Error).name !== "AbortError") setError((reason as Error).message); }
    finally { if (contextRef.current === owner) { operation.current = false; setActionBusy(null); } }
  };

  const download = async () => {
    if (!job || !recapHasResult(job) || operation.current) return;
    const snapshot = job; const owner = context; operation.current = true; setActionBusy("download"); setError("");
    try {
      const blob = await request(`/api/video-summary/jobs/${encodeURIComponent(snapshot.id)}/report.json`, async response => {
        if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new Error("The backend returned an unexpected recap file.");
        const file = await response.blob();
        if (!file.size || file.size > 64 * 1024 * 1024) throw new Error("The recap file is empty or exceeds the download limit.");
        const parsed = JSON.parse(await file.text()); const result = parseVideoSummaryJob(parsed.job ?? parsed);
        if (result.id !== snapshot.id || result.source.id !== snapshot.source.id || !recapHasResult(result)) throw new Error("The downloaded recap does not match this result.");
        return file;
      });
      if (contextRef.current === owner) downloadReport(new File([blob], `video-recap-${snapshot.id}.json`, { type: "application/json" }));
    } catch (reason) { if (contextRef.current === owner && (reason as Error).name !== "AbortError") setError((reason as Error).message); }
    finally { if (contextRef.current === owner) { operation.current = false; setActionBusy(null); } }
  };

  return { job: ownedJob, plan: ownedPlan, open, setOpen, openRecap, mode, setMode, domainOverride, setDomainOverride, includeAudio, setIncludeAudio, narrationEnabled, setNarrationEnabled, narratingWindow, awaitingSummary, planLoading, actionBusy, error, eligible, active, ownsUploadedAnalysis, guidanceResumed, resumeGuidance, refresh, loadPlan, start: () => perform("start"), cancel: () => perform("cancel"), retry: () => perform("retry"), download, notifyPlayback };
}
export type VideoRecapState = ReturnType<typeof useVideoRecap>;
