import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch, apiJson, sessionId } from "./api";
import type { Stage, ModelOption } from "./types";
import type { GuardianEntry, AppState } from "./store";
import { grabFrame } from "./frameBus";
export interface Observation {
  summary: string;
  guidance: string;
  principle: string;
  status: "ok" | "watch" | "alert";
  concern: string;
  current_step_id: string | null;
}
export interface Workflow {
  title: string;
  steps: Stage[];
  source: "document" | "inferred" | "none";
  principles: string[];
  warnings: string[];
}
export interface ReferenceResponse {
  ok: boolean;
  filename: string;
  workflow: Workflow;
  revision: number;
  current_stage_id: string;
}
export interface AnalysisResponse extends ReferenceResponse {
  observation: Observation;
  ms: number;
  prompt: string;
  used_frames: number;
  simulated?: boolean;
  source_id?: string;
  observed_at_s?: number;
  observed_at?: number;
  image_quality?: "available" | "unusable";
  stats: { checks: number; cacheHits: number; lastLatency: number };
}
interface Bindings {
  apiBase: string;
  model: ModelOption;
  setStages: (s: Stage[]) => void;
  setCurrentStageId: (s: string) => void;
  setGuidance: (s: string) => void;
  setAiSummary: AppState["setAiSummary"];
  setVideoUrl: (s: string | null) => void;
  setRunning: (b: boolean) => void;
  setMonitorAlert: AppState["setMonitorAlert"];
  stopLiveVideo: () => void;
  addLog: AppState["addLog"];
  setModel: (m: ModelOption) => void;
  setMonitor: AppState["setMonitor"];
}
export function useGuidanceState(bindings: Bindings) {
  const ref = useRef(bindings);
  ref.current = bindings;
  const [workflow, setWorkflow] = useState<Workflow>({
    title: "Visual guidance",
    steps: [],
    source: "none",
    principles: [],
    warnings: [],
  });
  const [referenceName, setReferenceName] = useState("");
  const [revision, setRevision] = useState(0);
  const [sourceId, setSourceId] = useState<string>(() => crypto.randomUUID());
  const [sourceName, setSourceName] = useState("");
  const [sampleVideoId, setSampleVideoId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<
    "video" | "camera" | "screen" | null
  >(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [videoFps, setVideoFps] = useState<number | null>(null);
  const [serverVideoReady, setServerVideoReady] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [timelineEpoch, setTimelineEpoch] = useState(0);
  const [health, setHealth] = useState<{
    ok: boolean;
    mock?: boolean;
    providers?: Record<string, boolean>;
  } | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState<AnalysisResponse | null>(
    null,
  );
  const [analysisStats, setAnalysisStats] = useState({
    checks: 0,
    cacheHits: 0,
    lastLatency: 0,
  });
  const [analysisError, setAnalysisError] = useState("");
  const uploadAbort = useRef<AbortController>();
  const sourceGeneration = useRef(0);
  const currentSource = useRef(sourceId);
  const currentRevision = useRef(0);
  const transitions = useRef<Promise<unknown>>(Promise.resolve());
  const seekGeneration = useRef(0);
  const applyReference = useCallback((j: ReferenceResponse) => {
    if (j.revision < currentRevision.current) return;
    currentRevision.current = j.revision;
    ref.current.setAiSummary(null);
    ref.current.setGuidance(
      "Review the workflow and analyze the current view for guidance.",
    );
    setWorkflow(j.workflow);
    setReferenceName(j.filename || "");
    setRevision(j.revision);
    ref.current.setStages(j.workflow.steps);
    ref.current.setCurrentStageId(
      j.current_stage_id || j.workflow.steps[0]?.id || "",
    );
    setLastAnalysis(null);
    setAnalysisError("");
  }, []);
  const refreshWorkflow = useCallback(async () => {
    const j = await apiJson<ReferenceResponse>(
      `${ref.current.apiBase}/api/reference`,
    );
    applyReference(j);
  }, [applyReference]);
  useEffect(() => {
    let active = true;
    const generation = sourceGeneration.current;
    void apiJson<{
      ok: boolean;
      mock: boolean;
      providers: Record<string, boolean>;
    }>(`${bindings.apiBase}/api/health`)
      .then((h) => {
        if (active) setHealth(h);
      })
      .catch(() => {
        if (active) setHealth({ ok: false });
      });
    void apiJson<{
      ok: boolean;
      models: ModelOption[];
      providers: Record<string, boolean>;
    }>(`${bindings.apiBase}/api/llm/models`)
      .then((j) => {
        if (!active) return;
        // Catalog refreshes must preserve an available user choice, including
        // a custom model, rather than replacing it with the first server option.
        if (j.providers[ref.current.model.provider]) return;
        const best = j.models.find((m) => j.providers[m.provider]);
        if (best) {
          ref.current.setModel(best);
          ref.current.setMonitor({
            provider: best.provider,
            modelId: best.model_id,
            display: best.display,
          });
        }
      })
      .catch(() => {});
    void apiJson<
      ReferenceResponse & {
        source_id?: string;
        stats?: typeof analysisStats;
        video?: { name: string; sample_video_id?: string | null; stream_url: string; info?: { fps: number } };
        observations?: Array<{ time: number; value: Observation }>;
      }
    >(`${bindings.apiBase}/api/session`)
      .then((j) => {
        if (!active || generation !== sourceGeneration.current) return;
        applyReference(j);
        setSampleVideoId(j.video?.sample_video_id || null);
        if (j.stats) setAnalysisStats(j.stats);
        if (j.source_id) {
          setSourceId(j.source_id);
          currentSource.current = j.source_id;
        }
        if (j.video) {
          ref.current.setVideoUrl(
            `${ref.current.apiBase}${j.video.stream_url}`,
          );
          setSourceKind("video");
          setSourceName(j.video.name);
          setVideoFps(
            j.video.info?.fps && j.video.info.fps > 0 ? j.video.info.fps : null,
          );
          setServerVideoReady(true);
          setSourceReady(true);
        }
      })
      .catch(() => {});
    const changed = () => {
      void refreshWorkflow().catch((error) => toast.error(String(error)));
    };
    window.addEventListener("guidance-reference-updated", changed);
    return () => {
      active = false;
      window.removeEventListener("guidance-reference-updated", changed);
    };
  }, [bindings.apiBase, applyReference, refreshWorkflow]);
  useEffect(() => () => uploadAbort.current?.abort(), []);
  const resetSource = useCallback(
    (kind: "video" | "camera" | "screen", name: string) => {
      uploadAbort.current?.abort();
      sourceGeneration.current++;
      setUploading(false);
      setServerVideoReady(false);
      setVideoFps(null);
      setSourceFile(null);
      setSampleVideoId(null);
      setSourceKind(kind);
      setSourceName(name);
      const nextSource = crypto.randomUUID();
      currentSource.current = nextSource;
      setSourceId(nextSource);
      setSourceReady(false);
      ref.current.setAiSummary(null);
      setTimelineEpoch((e) => e + 1);
      setLastAnalysis(null);
      setAnalysisStats({ checks: 0, cacheHits: 0, lastLatency: 0 });
      setAnalysisError("");
      ref.current.setGuidance(
        "Waiting for the first observation of this source.",
      );
      ref.current.setMonitorAlert(null);
      const steps = (workflow.source === "inferred" ? [] : workflow.steps).map(
        (s) => ({
          ...s,
          confidence: 0,
          progress: 0,
          complete: false,
          confirmation: undefined,
          criteria: s.criteria.map((c) => ({
            ...c,
            status: "unknown" as const,
            evidence: undefined,
          })),
        }),
      );
      ref.current.setStages(steps);
      setWorkflow((w) =>
        w.source === "inferred"
          ? {
              title: "Visual guidance",
              steps: [],
              principles: [],
              source: "none",
              warnings: [],
            }
          : { ...w, steps },
      );
      const generation = sourceGeneration.current;
      const task = transitions.current
        .catch(() => {})
        .then(async () => {
          const j = await apiJson<ReferenceResponse>(
            `${ref.current.apiBase}/api/source`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source_id: nextSource, kind, name }),
            },
          );
          if (generation === sourceGeneration.current) {
            applyReference(j);
            setSourceReady(true);
          }
          return nextSource;
        });
      transitions.current = task;
      void task.catch((error) => {
        if (generation === sourceGeneration.current)
          setAnalysisError(String(error));
      });
      return task;
    },
    [workflow.steps, workflow.source, applyReference],
  );
  const loadVideo = useCallback(
    async (file: File) => {
      if (
        !/^video\//.test(file.type) &&
        !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name)
      ) {
        toast.error("Choose a supported video file");
        return false;
      }
      ref.current.stopLiveVideo();
      const sourceTask = resetSource("video", file.name);
      setSourceFile(file);
      ref.current.setVideoUrl(URL.createObjectURL(file));
      ref.current.addLog({
        ts: Date.now(),
        level: "success",
        source: "System",
        msg: `Video ready for local playback: ${file.name}`,
      });
      const generation = sourceGeneration.current;
      const controller = new AbortController();
      uploadAbort.current = controller;
      setUploading(true);
      void sourceTask
        .then((id) => {
          if (controller.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          const upload = new FormData();
          upload.append("source_id", id);
          upload.append("file", file);
          return apiJson<{ ok: boolean; info: { fps: number } }>(
            `${ref.current.apiBase}/api/video/upload`,
            {
              method: "POST",
              body: upload,
              signal: controller.signal,
            },
          );
        })
        .then((j) => {
          if (generation === sourceGeneration.current) {
            setServerVideoReady(true);
            setVideoFps(
              Number.isFinite(j.info.fps) && j.info.fps > 0 ? j.info.fps : null,
            );
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            ref.current.addLog({
              ts: Date.now(),
              level: "warn",
              source: "System",
              msg: `Server video copy unavailable. Local frame guidance works; clips are unavailable. ${String(error)}`,
            });
        })
        .finally(() => {
          if (generation === sourceGeneration.current) setUploading(false);
        });
      return true;
    },
    [resetSource],
  );
  const loadGuidance = useCallback(
    async (file: File) => {
      setReferenceLoading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const j = await apiJson<ReferenceResponse>(
          `${ref.current.apiBase}/api/reference/upload`,
          { method: "POST", body: form },
        );
        applyReference(j);
        toast.success(
          `Extracted ${j.workflow.steps.length} steps from ${file.name}`,
        );
        return true;
      } catch (error) {
        toast.error(String(error));
        return false;
      } finally {
        setReferenceLoading(false);
      }
    },
    [applyReference],
  );
  const loadSampleVideo = useCallback(
    async (id: string, name: string) => {
      ref.current.setRunning(false);
      ref.current.stopLiveVideo();
      ref.current.setVideoUrl(null);
      const sourceTask = resetSource("video", name);
      const generation = sourceGeneration.current;
      const controller = new AbortController();
      uploadAbort.current = controller;
      setUploading(true);
      try {
        const source = await sourceTask;
        if (
          controller.signal.aborted ||
          generation !== sourceGeneration.current
        )
          return false;
        const result = await apiJson<
          ReferenceResponse & {
            source_id: string;
            video_name: string;
            sample_video_id?: string;
            stream_url: string;
            info: { fps: number };
          }
        >(`${ref.current.apiBase}/api/video/load-sample`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, source_id: source }),
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          generation !== sourceGeneration.current ||
          result.source_id !== currentSource.current
        )
          return false;
        applyReference(result);
        setSourceName(result.video_name);
        setSampleVideoId(result.sample_video_id || null);
        setServerVideoReady(true);
        setVideoFps(
          Number.isFinite(result.info.fps) && result.info.fps > 0
            ? result.info.fps
            : null,
        );
        ref.current.setVideoUrl(`${ref.current.apiBase}${result.stream_url}`);
        setSourceReady(true);
        toast.success(`Loaded ${result.video_name} with ${result.filename}`);
        return true;
      } catch (error) {
        if (
          !controller.signal.aborted &&
          generation === sourceGeneration.current
        ) {
          setAnalysisError(String(error));
          toast.error(String(error));
        }
        return false;
      } finally {
        if (generation === sourceGeneration.current) setUploading(false);
      }
    },
    [resetSource, applyReference],
  );
  const loadSample = useCallback(
    async (filename: string) => {
      setReferenceLoading(true);
      try {
        const j = await apiJson<ReferenceResponse>(
          `${ref.current.apiBase}/api/reference/load-sample`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename }),
          },
        );
        applyReference(j);
        toast.success(`Loaded ${j.workflow.steps.length} guidance steps`);
      } catch (error) {
        toast.error(String(error));
      } finally {
        setReferenceLoading(false);
      }
    },
    [applyReference],
  );
  const clearGuidance = useCallback(async () => {
    const j = await apiJson<ReferenceResponse>(
      `${ref.current.apiBase}/api/reference`,
      { method: "DELETE" },
    );
    applyReference(j);
  }, [applyReference]);
  const applyAnalysis = useCallback((j: AnalysisResponse) => {
    if (
      (j.source_id && j.source_id !== currentSource.current) ||
      j.revision < currentRevision.current
    )
      return;
    currentRevision.current = j.revision;
    ref.current.setAiSummary(null);
    setWorkflow(j.workflow);
    setRevision(j.revision);
    ref.current.setStages(j.workflow.steps);
    ref.current.setCurrentStageId(j.current_stage_id);
    ref.current.setGuidance(j.observation.guidance);
    setLastAnalysis(j);
    setAnalysisStats(j.stats);
    setAnalysisError("");
  }, []);
  const confirmStep = useCallback(
    async (id: string, complete: boolean) => {
      const j = await apiJson<ReferenceResponse>(
        `${ref.current.apiBase}/api/workflow/steps/${id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ complete, current_s: grabFrame().currentS }),
        },
      );
      applyReference(j);
    },
    [applyReference],
  );
  const resetProgress = useCallback(async () => {
    applyReference(
      await apiJson<ReferenceResponse>(
        `${ref.current.apiBase}/api/workflow/reset`,
        { method: "POST" },
      ),
    );
  }, [applyReference]);
  const requestAnalysis = useCallback(
    () => window.dispatchEvent(new Event("guidance-analyze-now")),
    [],
  );
  const resetTimeline = useCallback(() => {
    const generation = ++seekGeneration.current;
    const source = currentSource.current;
    const time = grabFrame().currentS;
    setTimelineEpoch((e) => e + 1);
    setSourceReady(false);
    setLastAnalysis(null);
    ref.current.setMonitorAlert(null);
    ref.current.setAiSummary(null);
    const task = transitions.current
      .catch(() => {})
      .then(async () => {
        const j = await apiJson<ReferenceResponse>(
          `${ref.current.apiBase}/api/workflow/seek`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_id: source, current_s: time }),
          },
        );
        if (
          generation === seekGeneration.current &&
          source === currentSource.current
        ) {
          applyReference(j);
          setSourceReady(true);
        }
      });
    transitions.current = task;
    void task.catch((error) => {
      if (generation === seekGeneration.current)
        setAnalysisError(String(error));
    });
  }, [applyReference]);
  return {
    workflow,
    referenceName,
    revision,
    sourceId,
    sourceReady,
    sourceName,
    sampleVideoId,
    sourceKind,
    sourceFile,
    uploading,
    serverVideoReady,
    videoFps,
    referenceLoading,
    timelineEpoch,
    health,
    lastAnalysis,
    analysisStats,
    analysisError,
    setAnalysisError,
    loadVideo,
    loadSampleVideo,
    loadGuidance,
    loadSample,
    clearGuidance,
    refreshWorkflow,
    applyAnalysis,
    confirmStep,
    resetProgress,
    requestAnalysis,
    resetSource,
    resetTimeline,
  };
}
export type GuidanceState = ReturnType<typeof useGuidanceState>;
