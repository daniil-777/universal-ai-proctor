import { useEffect, useRef } from "react";
import { useApp } from "./store";
import { apiFetch } from "./api";
import {
  bufferFrame,
  clearFrames,
  grabFrame,
  recentFrameSamples,
  sampleVideoOverview,
} from "./frameBus";
import type { AnalysisResponse } from "./guidanceState";
import { speak } from "./speech";
export function useGeneralGuidance() {
  const a = useApp();
  const latest = useRef(a);
  latest.current = a;
  const settingsKey = JSON.stringify({
    provider: a.monitor.active ? a.monitor.provider : a.model.provider,
    model: a.monitor.active ? a.monitor.modelId : a.model.model_id,
    detail: a.analysis.visionDetail,
    method: a.monitor.active ? a.monitor.method : a.analysis.method,
    mosaic: a.monitor.active ? a.monitor.mosaicN : a.analysis.mosaicN,
    compress: a.analysis.compress,
    crop: a.analysis.cropRect,
    window: a.monitor.windowSecs,
    frames: a.monitor.nFrames,
    experience: a.experience,
    demo: a.useMock,
  });
  const contextKey = JSON.stringify([
    a.apiBase,
    a.sourceId,
    a.revision,
    a.timelineEpoch,
    a.preferencesRevision,
    a.preferencesReady,
    a.sourceReady,
    a.serverVideoReady,
    a.running,
    a.monitor.active,
    a.sourceKind === "video" && !!a.recap?.ownsUploadedAnalysis,
    settingsKey,
  ]);
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const forceRef = useRef<() => void>();
  useEffect(() => {
    if (latest.current.sourceKind === "video" && latest.current.recap?.ownsUploadedAnalysis) {
      clearFrames(); latest.current.setGuardianBusy(false); return;
    }
    const requestContext = contextRef.current;
    let stopped = false,
      busy = false,
      lastTime = -1,
      latestCapturedTime = -1,
      failures = 0,
      forcePending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let lastAlert = "";
    let lastAlertEarlier: boolean | undefined;
    let overview: { frames: string[]; times: number[] } | undefined;
    clearFrames();
    const capture = () => {
      const now = latest.current;
      if (document.hidden || (!now.running && !now.monitor.active)) return;
      // Recorded videos are sampled from the server copy. Encoding a browser
      // JPEG four times a second here would be discarded at request time.
      if (now.sourceKind === "video" && now.serverVideoReady && !now.liveStream) return;
      const frame = grabFrame();
      latestCapturedTime = frame.currentS;
      bufferFrame(frame);
    };
    // Retain dense recent motion and bounded older context while inference is
    // pending; the next check can cover elapsed camera footage without a gap.
    const sampler = setInterval(capture, 250);
    const tick = async (force = false) => {
      if (stopped) return;
      if (busy) {
        forcePending ||= force;
        return;
      }
      force ||= forcePending;
      forcePending = false;
      if (document.hidden) {
        schedule(2000);
        return;
      }
      const now = latest.current;
      if (!now.preferencesReady) {
        forcePending ||= force;
        schedule(500);
        return;
      }
      const frame = grabFrame();
      latestCapturedTime = frame.currentS;
      if (
        !now.sourceReady ||
        !frame.b64 ||
        (!force && !now.running && !now.monitor.active)
      ) {
        schedule(500);
        return;
      }
      if (
        !force &&
        !now.liveStream &&
        Math.abs(frame.currentS - lastTime) < 0.2
      ) {
        schedule(500);
        return;
      }
      const started = Date.now();
      busy = true;
      now.setGuardianBusy(true);
      const requestController = new AbortController();
      controller = requestController;
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, 50000);
      const valid = () =>
        !stopped &&
        contextRef.current === requestContext &&
        !requestController.signal.aborted &&
        !document.hidden;
      bufferFrame(frame);
      try {
        const mosaic = now.monitor.active
          ? now.monitor.method === "Mosaic"
          : now.analysis.method === "Mosaic";
        const mosaicN = now.monitor.active
          ? now.monitor.mosaicN
          : now.analysis.mosaicN;
        const frameCount = mosaic ? mosaicN ** 2 : now.monitor.nFrames;
        const samplingWindow = now.liveStream && lastTime >= 0
          ? Math.min(30, Math.max(now.monitor.windowSecs, frame.currentS - lastTime + 0.5))
          : now.monitor.windowSecs;
        const samples = recentFrameSamples(
          samplingWindow,
          frameCount,
          !mosaic,
        );
        let frames = samples.length ? samples.map((f) => f.b64) : [frame.b64];
        let frameTimes = samples.length
          ? samples.map((f) => f.currentS)
          : [frame.currentS];
        let inferOverview = false;
        if (
          !now.workflow.steps.length &&
          now.sourceKind === "video" &&
          now.videoUrl
        ) {
          try {
            if (!overview) {
              let times: number[] = [];
              const sampled = await sampleVideoOverview(
                now.videoUrl,
                4,
                (value) => {
                  times = value;
                },
                requestController.signal,
              );
              overview = { frames: sampled, times };
            }
            frames = overview.frames;
            frameTimes = overview.times;
            inferOverview = frames.length > 0;
          } catch {
            /* Current frame remains available. */
          }
        }
        // A complete server-owned window remains available immediately after a
        // seek; the browser ring buffer is still empty at that point.
        if (
          !inferOverview &&
          now.sourceKind === "video" &&
          now.serverVideoReady &&
          !now.liveStream
        ) {
          frames = [];
          frameTimes = [];
        }
        if (timedOut) throw new Error("Guardian request timed out. Retrying…");
        if (!valid()) return;
        const selected = now.monitor.active
          ? { provider: now.monitor.provider, model_id: now.monitor.modelId }
          : now.model;
        const response = await apiFetch(`${now.apiBase}/api/guidance/analyze`, {
          method: "POST",
          signal: requestController.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selected,
            current_s: frame.currentS,
            source_id: now.sourceId,
            revision: now.revision,
            preferences_revision: now.preferencesRevision,
            frames_b64: frames,
            frame_times_s: frameTimes,
            vision_detail: now.analysis.visionDetail,
            processing: mosaic ? "mosaic" : "sampling",
            mosaic_n: mosaicN,
            n_samples: frameCount,
            window_s: samplingWindow,
            compress: now.analysis.compress,
            experience_level: now.experience.toLowerCase(),
            demo: now.useMock,
            infer_overview: inferOverview,
            crop_rect: now.analysis.cropRect,
          }),
        });
        const j = await response.json();
        if (!response.ok || !j.ok)
          throw Object.assign(
            new Error(j.error || `Analysis failed (${response.status})`),
            { status: response.status },
          );
        if (timedOut) throw new Error("Guardian request timed out. Retrying…");
        if (!valid()) return;
        const result = j as AnalysisResponse;
        latest.current.applyAnalysis(result);
        lastTime = frame.currentS;
        failures = 0;
        const observed = result.observation;
        const viewAge = now.liveStream
          ? Math.max(0, latestCapturedTime - (result.observed_at_s ?? frame.currentS))
          : 0;
        const earlierView = viewAge > Math.max(2, now.monitor.intervalSecs);
        latest.current.pushGuardianLog({
          sourceId: now.sourceId,
          sourceKind: now.sourceKind,
          sourceName: now.sourceName,
          referenceName: now.referenceName,
          id: crypto.randomUUID(),
          ts: Date.now(),
          status: observed.status,
          text: observed.summary,
          ms: result.ms,
          videoS: result.observed_at_s ?? frame.currentS,
        });
        latest.current.addLog({
          ts: Date.now(),
          source: "Event",
          level: "info",
          msg: `Observed ${frame.currentS.toFixed(1)}s · ${result.used_frames} frame(s) · ${result.ms} ms${result.simulated ? " · demo" : ""}`,
        });
        if (observed.status === "ok" || !observed.concern) {
          lastAlert = "";
          lastAlertEarlier = undefined;
          latest.current.setMonitorAlert(null);
        }
        const alertKey = `${observed.status}:${observed.concern}`;
        const newConcern = lastAlert !== alertKey;
        if (
          now.monitor.active &&
          observed.status !== "ok" &&
          observed.concern &&
          (newConcern || lastAlertEarlier !== earlierView)
        ) {
          lastAlert = alertKey;
          lastAlertEarlier = earlierView;
          latest.current.setMonitorAlert({
            status: observed.status === "alert" ? "alert" : "watch",
            text: earlierView
              ? `Earlier view (${Math.round(viewAge)} s ago): ${observed.concern}`
              : observed.concern,
            ts: Date.now(),
          });
          if (newConcern && latest.current.monitor.voiceOn)
            void speak(now.apiBase, earlierView
              ? `In the earlier view, ${observed.concern}`
              : observed.concern, {
              priority: observed.status === "alert",
            });
        }
      } catch (error) {
        if (!stopped && (timedOut || !requestController.signal.aborted)) {
          failures++;
          const message = timedOut
            ? "Guardian request timed out. Retrying…"
            : error instanceof Error
              ? error.message
              : String(error);
          latest.current.setAnalysisError(message);
          if (message.includes("Guidance goals changed"))
            void latest.current.refreshPreferences();
          if (failures === 1)
            latest.current.addLog({
              ts: Date.now(),
              level: "error",
              source: "System",
              msg: message,
            });
        }
      } finally {
        clearTimeout(deadline);
        if (controller === requestController) controller = undefined;
        busy = false;
        if (!stopped) {
          latest.current.setGuardianBusy(false);
          if (forcePending && !document.hidden) {
            // Collapse repeated clicks into one fresh observation after this one.
            timer = setTimeout(() => void tick(true), 0);
          } else {
            const interval = Math.max(
              1000,
              latest.current.monitor.intervalSecs * 1000,
            );
            const delay = failures
              ? Math.min(15000, interval * 2 ** Math.min(4, failures - 1))
              : Math.max(250, interval - (Date.now() - started));
            schedule(delay);
          }
        }
      }
    };
    function schedule(ms: number) {
      if (timer) clearTimeout(timer);
      if (stopped) return;
      const now = latest.current;
      if (now.running || now.monitor.active || forcePending)
        timer = setTimeout(() => void tick(), ms);
    }
    forceRef.current = () => {
      if (timer) clearTimeout(timer);
      void tick(true);
    };
    const visibility = () => {
      if (document.hidden) {
        controller?.abort();
        clearFrames();
      } else {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    void tick();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      stopped = true;
      latest.current.setGuardianBusy(false);
      controller?.abort();
      clearInterval(sampler);
      if (timer) clearTimeout(timer);
      forceRef.current = undefined;
    };
  }, [contextKey]);
  useEffect(() => {
    const force = () => forceRef.current?.();
    window.addEventListener("guidance-analyze-now", force);
    return () => window.removeEventListener("guidance-analyze-now", force);
  }, []);
}
