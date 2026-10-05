import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Copy, Download, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

// Colors for known sources; anything new gets the fallback automatically.
const SOURCE_COLOR: Record<string, string> = {
  Simulator: "text-primary",
  SimParams: "text-[hsl(189,70%,55%)]", // live parameter digests — teal, distinct from events
  Prompt: "text-warning",
  Event: "text-success",
  System: "text-muted-foreground",
  Guardian: "text-destructive",
  Reference: "text-success",
};
const colorFor = (s: string): string =>
  SOURCE_COLOR[s] ?? "text-muted-foreground";

// Preferred chip order for known sources; unknown ones append as they appear.
const SOURCE_ORDER = [
  "Simulator",
  "SimParams",
  "Guardian",
  "Prompt",
  "Reference",
  "Event",
  "System",
];

export function LogsTab() {
  const a = useApp();
  // Track HIDDEN sources (not shown) — so sources that appear later (SimParams,
  // Guardian, …) are visible by default instead of being silently filtered out.
  const [hidden, setHidden] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter chips = every source that actually occurs in the log.
  const sources = useMemo(() => {
    const present: string[] = [...new Set(a.logs.map((l) => l.source))];
    return [
      ...SOURCE_ORDER.filter((s) => present.includes(s)),
      ...present.filter((s) => !SOURCE_ORDER.includes(s)),
    ];
  }, [a.logs]);

  const filtered = a.logs.filter((l) => !hidden.includes(l.source));

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered.length]);

  const copy = () => {
    navigator.clipboard.writeText(
      filtered
        .map((l) => `[${new Date(l.ts).toISOString()}] ${l.source} ${l.msg}`)
        .join("\n"),
    );
    toast.success("Copied");
  };
  const download = () => {
    const blob = new Blob(
      [
        filtered
          .map(
            (l) =>
              `${new Date(l.ts).toISOString()}\t${l.source}\t${l.level}\t${l.msg}`,
          )
          .join("\n"),
      ],
      { type: "text/plain" },
    );
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(blob);
    a2.download = `logs-${Date.now()}.txt`;
    a2.click();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="multiple"
          value={sources.filter((s) => !hidden.includes(s))}
          onValueChange={(v) => {
            if (v.length) setHidden(sources.filter((s) => !v.includes(s)));
          }}
          className="flex-wrap"
        >
          {sources.map((s) => (
            <ToggleGroupItem
              key={s}
              value={s}
              className="h-6 px-2 text-[11px] data-[state=on]:bg-secondary"
            >
              {s}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => toast("Refreshed")}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={download}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin font-mono text-[11px] px-3 py-2 space-y-0.5"
      >
        {filtered.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-muted-foreground/60 shrink-0">
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            <Badge
              variant="outline"
              className={`h-4 px-1 text-[9px] shrink-0 ${colorFor(l.source)}`}
            >
              {l.source}
            </Badge>
            <span
              className={
                l.level === "error"
                  ? "text-destructive"
                  : l.level === "warn"
                    ? "text-warning"
                    : ""
              }
            >
              {l.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
