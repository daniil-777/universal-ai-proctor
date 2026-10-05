// GuardianTab — persistent real-time history of every Guardian prediction:
// wall time, video time, tier (ok / watch / alert), the "thought" text, check
// latency, and source (LLM vision vs deterministic telemetry rule). Live stats
// header + alerts-only filter. The transient brain-pill popover on the video
// shows the same data; this tab is the full research view.

import { useState } from "react";
import { useApp } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Brain, Eye, ShieldAlert, Zap } from "lucide-react";

function fmtVideoS(s?: number): string {
  if (s === undefined || !Number.isFinite(s)) return "—";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function GuardianTab() {
  const a = useApp();
  const [alertsOnly, setAlertsOnly] = useState(false);

  const log = a.guardianLog;
  const counts = {
    ok: log.filter((e) => e.status === "ok").length,
    watch: log.filter((e) => e.status === "watch").length,
    alert: log.filter((e) => e.status === "alert").length,
  };
  const visionChecks = log.filter((e) => e.ms > 0);
  const avgMs = visionChecks.length
    ? Math.round(
        visionChecks.reduce((s, e) => s + e.ms, 0) / visionChecks.length,
      )
    : 0;

  const shown = [
    ...(alertsOnly ? log.filter((e) => e.status !== "ok") : log),
  ].reverse();

  if (!log.length) {
    return (
      <div className="pt-8 text-center text-xs text-muted-foreground space-y-2">
        <Brain className="h-6 w-6 mx-auto opacity-40" />
        <p>No Guardian checks yet.</p>
        <p>
          Activate <b>Guardian</b> on the guidance bar — every prediction (scene
          notes, suspicions, alerts) appears here in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {/* Live stats header */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="outline" className="gap-1 text-[10px]">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> {counts.ok}{" "}
          ok
        </Badge>
        <Badge
          variant="outline"
          className="gap-1 text-[10px] text-warning border-warning/40"
        >
          <Eye className="h-2.5 w-2.5" /> {counts.watch} watch
        </Badge>
        <Badge
          variant="outline"
          className="gap-1 text-[10px] text-destructive border-destructive/40"
        >
          <ShieldAlert className="h-2.5 w-2.5" /> {counts.alert} alert
        </Badge>
        <span className="text-muted-foreground">· {avgMs}ms avg</span>
        <div className="flex-1" />
        <button
          aria-pressed={alertsOnly}
          onClick={() => setAlertsOnly((v) => !v)}
          className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
            alertsOnly
              ? "border-destructive/60 text-destructive bg-destructive/10"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {alertsOnly ? "showing alerts+watch" : "all checks"}
        </button>
      </div>

      {/* Tier timeline strip (oldest → newest) */}
      <div className="flex items-center gap-[2px] h-2 overflow-hidden rounded">
        {log.slice(-80).map((e) => (
          <span
            key={e.id}
            title={`${new Date(e.ts).toLocaleTimeString([], { hour12: false })} · ${e.status}: ${e.text}`}
            className={`h-full flex-1 rounded-[1px] ${
              e.status === "alert"
                ? "bg-destructive"
                : e.status === "watch"
                  ? "bg-warning"
                  : "bg-success/40"
            }`}
          />
        ))}
      </div>

      {/* History (newest first) */}
      <div className="space-y-0.5">
        {shown.map((e) => (
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
            {e.status === "alert" ? (
              <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
            ) : e.status === "watch" ? (
              <Eye className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0 mt-1.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground font-mono mb-1">
                <time>
                  {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
                </time>
                <span title="Video time">▶{fmtVideoS(e.videoS)}</span>
                <span className="ml-auto inline-flex items-center gap-0.5">
                  {e.ms > 0 ? (
                    `${e.ms}ms`
                  ) : (
                    <>
                      <Zap className="h-2.5 w-2.5" /> local
                    </>
                  )}
                </span>
              </div>
              <p
                className={`break-words leading-relaxed ${
                  e.status === "alert"
                    ? "text-destructive font-medium"
                    : e.status === "watch"
                      ? "text-warning font-medium"
                      : "text-foreground/85"
                }`}
              >
                {e.text}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
