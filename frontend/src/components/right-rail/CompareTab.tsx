import { useEffect, useRef, useState } from "react";
import { Download, GitCompare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { MODELS } from "@/lib/mockData";
import { apiFetch, apiJson } from "@/lib/api";
import { grabFrame, bufferFrame, recentFrameSamples } from "@/lib/frameBus";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export function CompareTab() {
  const a = useApp();
  const controller = useRef<AbortController | null>(null);
  const context = `${a.sourceId}:${a.revision}:${a.timelineEpoch}`;
  const latestContext = useRef(context);
  latestContext.current = context;
  useEffect(() => {
    setResults([]);
    return () => controller.current?.abort();
  }, [context]);
  const [other, setOther] = useState("gpt-4o");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    Array<{
      model_id: string;
      ms: number;
      error?: string;
      observation?: { summary: string; guidance: string };
    }>
  >([]);
  const compare = async () => {
    const frame = grabFrame();
    if (!frame.b64) {
      toast.message("Load a playable source first");
      return;
    }
    bufferFrame(frame);
    const samples = recentFrameSamples(a.analysis.windowSecs, 4);
    const capturedContext = context;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const selected = MODELS.find((m) => m.model_id === other)!;
      const j = await apiJson<{ results: typeof results }>(
        `${a.apiBase}/api/compare`,
        {
          method: "POST",
          signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_id: a.sourceId,
            revision: a.revision,
            frames_b64: samples.map((sample) => sample.b64),
            frame_times_s: samples.map((sample) => sample.currentS),
            compress: a.analysis.compress,
            vision_detail: a.analysis.visionDetail,
            processing: a.analysis.method === "Mosaic" ? "mosaic" : "sampling",
            mosaic_n: a.analysis.mosaicN,
            current_s: frame.currentS,
            models: [a.model, selected],
          }),
        },
      );
      if (latestContext.current === capturedContext) setResults(j.results);
    } catch (error) {
      if (!abort.signal.aborted) toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    try {
      const response = await apiFetch(`${a.apiBase}/api/dataset`);
      if (!response.ok) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "guidance-session.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      toast.error(String(error));
    }
  };
  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl border p-3 space-y-3">
        <h2 className="text-sm font-semibold flex gap-2">
          <GitCompare className="h-4 w-4 text-primary" />
          Compare AI observations
        </h2>
        <p className="text-xs text-muted-foreground">
          Compare the same captured frames without changing your tracked
          progress.
        </p>
        <Select value={other} onValueChange={setOther}>
          <SelectTrigger aria-label="Comparison model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.model_id} value={m.model_id}>
                {m.display}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="w-full gap-2"
          disabled={busy}
          onClick={() => void compare()}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Compare now
        </Button>
      </div>
      {results.map((r, i) => (
        <div key={i} className="rounded-xl border p-3">
          <div className="text-xs font-semibold">
            {r.model_id} · {r.ms} ms
          </div>
          <p className="text-xs mt-2 leading-relaxed text-muted-foreground">
            {r.error || r.observation?.summary}
          </p>
          {r.observation && (
            <p className="text-xs mt-2">{r.observation.guidance}</p>
          )}
        </div>
      ))}
      <div className="rounded-xl border p-3">
        <h3 className="text-sm font-semibold">Session dataset</h3>
        <p className="text-xs text-muted-foreground mt-2 mb-3">
          Export the workflow, source document, and observed evidence as a ZIP.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => void download()}
        >
          <Download className="h-3.5 w-3.5" />
          Download session ZIP
        </Button>
      </div>
    </div>
  );
}
