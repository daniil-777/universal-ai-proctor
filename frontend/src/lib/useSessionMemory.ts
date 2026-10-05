import { apiFetch } from "./api";
// useSessionMemory.ts — maintains the session's memory:
//   1. Deterministic stage-transition events (video-timed) whenever the detected
//      stage changes — free and exact.
//   2. The rolling AI digest: every DIGEST_MS (while the Guardian is watching and
//      produced new observations) the previous digest + new events are folded by
//      a fast model into a fresh ≤60-word narrative. Constant-size memory.
// Each digest update is ALSO written to the Logs tab (source "History") so the
// operator can audit what the assistant believes has happened.

import { useEffect, useRef } from "react";
import { useApp } from "./store";
import { grabFrame } from "./frameBus";

const DIGEST_MS = 75_000; // ~1 cheap Haiku call per 75 s, only when there's news

export function useSessionMemory(): void {
  const a = useApp();
  const aRef = useRef(a);
  aRef.current = a;

  const context = `${a.apiBase}|${a.sourceId}|${a.revision}|${a.timelineEpoch}|${a.preferencesRevision}`;
  const stageContext = useRef(context);

  // ── 1. Stage transitions → sessionEvents ────────────────────────────────────
  const prevStageRef = useRef<string>("");
  useEffect(() => {
    const id = a.currentStageId;
    if (stageContext.current !== context) {
      stageContext.current = context;
      prevStageRef.current = id;
      return;
    }
    if (!id || id === prevStageRef.current) return;
    const first = prevStageRef.current === "";
    prevStageRef.current = id;
    if (first) return; // don't record the initial mount as a "transition"
    const name = a.stages.find((s) => s.id === id)?.name ?? id;
    a.pushSessionEvent({
      ts: Date.now(),
      videoS: grabFrame().currentS,
      type: "stage",
      text: `${id} ${name}`.trim(),
    });
  }, [a.currentStageId, context]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Rolling digest loop ──────────────────────────────────────────────────
  const digestedUpTo = useRef(0); // guardianLog timestamp watermark
  const digestedEntries = useRef(new WeakSet<object>());
  const busyRef = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const contextRef = useRef(context);

  useEffect(() => {
    if (contextRef.current === context) return;
    contextRef.current = context;
    pending.current?.abort();
    // Keep the audit log, but never fold observations from an earlier source,
    // instruction revision, or position into the current view's memory.
    digestedUpTo.current = Date.now();
    digestedEntries.current = new WeakSet([
      ...aRef.current.guardianLog,
      ...aRef.current.sessionEvents,
    ]);
    prevStageRef.current = a.currentStageId;
    a.setSessionDigest("");
  }, [context]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const app = aRef.current;
      if (busyRef.current || document.hidden) return;
      const requestContext = contextRef.current;
      // Fold only meaningful events: guardian watches/alerts + stage transitions
      // since the last digest ("scene clear" noise is dropped by the prompt rules,
      // but we pre-filter the pure-ok entries to keep the request tiny).
      const newGuardian = app.guardianLog.filter(
        (e) =>
          e.ts >= digestedUpTo.current &&
          !digestedEntries.current.has(e) &&
          (e.status !== "ok" || app.guardianLog.length < 6),
      );
      const newStages = app.sessionEvents.filter(
        (e) => e.ts >= digestedUpTo.current && !digestedEntries.current.has(e),
      );
      if (!newGuardian.length && !newStages.length) return;

      const fmtV = (s?: number) =>
        typeof s === "number"
          ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
          : "?";
      const events = [
        ...newStages.map((e) => `[video ${fmtV(e.videoS)}] stage → ${e.text}`),
        ...newGuardian.map(
          (e) => `[video ${fmtV(e.videoS)}] ${e.status}: ${e.text}`,
        ),
      ];

      busyRef.current = true;
      const controller = new AbortController();
      pending.current = controller;
      const watermark = Math.max(...newGuardian.map(e => e.ts), ...newStages.map(e => e.ts));
      try {
        const res = await apiFetch(`${app.apiBase}/api/history/digest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prev: app.sessionDigest, events }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const j = (await res.json()) as { ok?: boolean; digest?: string };
        if (mounted && !controller.signal.aborted && requestContext === contextRef.current &&
            j.ok && typeof j.digest === "string" && j.digest) {
          // Events that arrive while this request runs belong to the next fold.
          digestedUpTo.current = watermark;
          [...newGuardian, ...newStages].forEach((e) => digestedEntries.current.add(e));
          aRef.current.setSessionDigest(j.digest);
          // Auditable memory: the compact history lands in the Logs tab.
          aRef.current.addLog({
            ts: Date.now(),
            level: "info",
            source: "History",
            msg: `📝 ${j.digest}`,
          });
        }
      } catch {
        /* transient — retry next interval */
      } finally {
        busyRef.current = false;
        if (pending.current === controller) pending.current = null;
      }
    };

    const iv = window.setInterval(tick, DIGEST_MS);
    return () => {
      mounted = false;
      window.clearInterval(iv);
      pending.current?.abort();
    };
  }, []);
}
