import { useApp } from "@/lib/store";
import { useEffect, useState } from "react";
import { apiJson } from "@/lib/api";
interface Benchmark {
  available: boolean;
  model?: string;
  cases_evaluated?: number;
  metrics?: Record<
    string,
    {
      cases: number;
      passed: number;
      fact_recall: number;
      latency_p50_ms: number | null;
    }
  >;
}
export function MetricsTab() {
  const a = useApp();
  const [benchmark, setBenchmark] = useState<Benchmark>();
  useEffect(() => {
    const controller = new AbortController();
    void apiJson<Benchmark>(`${a.apiBase}/api/evaluation/latest`, {
      signal: controller.signal,
    })
      .then(setBenchmark)
      .catch(() => {});
    return () => controller.abort();
  }, [a.apiBase]);
  const stats = a.analysisStats;
  const confirmed = a.stages.filter((s) => s.complete).length;
  const rows = [
    { label: "Confirmed steps", value: `${confirmed} / ${a.stages.length}` },
    { label: "Checks recorded", value: stats?.checks || a.guardianLog.length },
    {
      label: "Last observation",
      value: stats.lastLatency ? `${stats.lastLatency} ms` : "—",
    },
    { label: "Frames analyzed", value: a.lastAnalysis?.used_frames || "—" },
    { label: "Cached observations", value: stats?.cacheHits || 0 },
    {
      label: "Workflow source",
      value:
        a.workflow.source === "inferred"
          ? "Provisional"
          : a.referenceName
            ? "Document"
            : "Visual",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 pt-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-xl border bg-card p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-relaxed">
            {row.label}
          </div>
          <div className="text-xl font-semibold tabular-nums text-primary mt-2">
            {row.value}
          </div>
        </div>
      ))}
      <p className="col-span-2 text-[11px] leading-relaxed text-muted-foreground">
        These are measured session statistics. Simulator measurements are
        reserved for a future telemetry adapter.
      </p>
      <section className="col-span-2 rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3">
        <h2 className="text-sm font-semibold">Answer quality benchmark</h2>
        {benchmark?.available && benchmark.metrics ? (
          <>
            <p className="text-xs text-muted-foreground">
              {benchmark.cases_evaluated} prepared video cases ·{" "}
              {benchmark.model}
            </p>
            {Object.entries(benchmark.metrics).map(([channel, metrics]) => (
              <div key={channel} className="rounded-lg border bg-card p-3">
                <h3 className="text-xs font-semibold">{channel}</h3>
                <dl className="mt-2 text-xs space-y-1">
                  <div className="flex justify-between gap-2">
                    <dt>Rubric fact recall</dt>
                    <dd>{Math.round(metrics.fact_recall * 100)}%</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>All checks passed</dt>
                    <dd>
                      {metrics.passed} / {metrics.cases}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Median reply</dt>
                    <dd>{metrics.latency_p50_ms ?? "—"} ms</dd>
                  </div>
                </dl>
              </div>
            ))}
            <a
              className="inline-flex min-h-10 items-center rounded-lg bg-primary px-3 text-xs text-primary-foreground font-medium"
              href={`${a.apiBase}/evaluation`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Compare expected and actual answers
            </a>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No answer benchmark results are available yet.
          </p>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Prepared synthetic video answers measure specific facts and
          contradictions. Clinical accuracy and physical speech recognition are
          not measured.
        </p>
      </section>
    </div>
  );
}
