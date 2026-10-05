import { Plug, SlidersHorizontal } from "lucide-react";
import { useApp } from "@/lib/store";
export function ParamsTab() {
  const a = useApp();
  const rows = {
    source: a.sourceKind || "none",
    document: a.referenceName || "none",
    revision: a.revision,
    observer: a.monitor.display,
    interval: `${a.monitor.intervalSecs}s`,
    context: `${a.monitor.windowSecs}s`,
    frames: a.monitor.nFrames,
    method: a.analysis.method,
    compression: a.analysis.compress ? "640px JPEG" : "1280px JPEG",
    simulator: "Not connected · integration planned",
  };
  return (
    <div className="pt-2 space-y-3">
      <h2 className="flex gap-2 items-center text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        Active configuration
      </h2>
      <dl className="rounded-xl border divide-y">
        {Object.entries(rows).map(([key, value]) => (
          <div key={key} className="p-2.5 flex justify-between gap-2 text-xs">
            <dt className="text-muted-foreground capitalize">{key}</dt>
            <dd className="text-right min-w-0 break-words [overflow-wrap:anywhere]">
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
        <Plug className="h-4 w-4 mb-2" />
        Simulator telemetry will use a separate adapter. No simulator data is
        assumed by the current guide.
      </div>
    </div>
  );
}
