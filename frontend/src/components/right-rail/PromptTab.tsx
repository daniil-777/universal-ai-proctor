// PromptTab — full transparency into what the LLM actually received per ask:
// the exact final prompt text (incl. SIMULATOR CONTEXT when injected) and small
// previews of the very frames that were attached. Newest first, last 10 asks.

import { useState } from "react";
import { useApp } from "@/lib/store";
import type { PromptRecord } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Copy, FileText, Mic } from "lucide-react";
import { toast } from "sonner";

function RecordCard({
  r,
  defaultOpen,
}: {
  r: PromptRecord;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.prompt);
      toast.success("Prompt copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2.5 py-2 flex items-center gap-2 text-left hover:bg-muted/30"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">
          {new Date(r.ts).toLocaleTimeString([], { hour12: false })}
        </span>
        {r.voice && <Mic className="h-3 w-3 text-primary shrink-0" />}
        <span className="text-xs truncate flex-1 min-w-0">{r.question}</span>
        <Badge variant="outline" className="text-[9px] shrink-0">
          {r.usedFrames}f · {r.processing}
        </Badge>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{r.model}</span>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={copy}
            >
              <Copy className="h-3 w-3" /> Copy prompt
            </Button>
          </div>

          {/* The frames the model actually saw */}
          {r.thumbs.length > 0 ? (
            <div className="flex gap-1.5 flex-wrap">
              {r.thumbs.map((b64, i) => (
                <img
                  key={i}
                  src={`data:image/jpeg;base64,${b64}`}
                  alt={`frame ${i + 1}`}
                  className="h-14 rounded border border-border object-cover"
                  title={`frame ${i + 1} of ${r.usedFrames}${r.processing === "mosaic" ? " (mosaic image sent as one)" : ""}`}
                />
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground italic">
              {r.processing === "whole_video"
                ? "whole video clip sent (no frame previews)"
                : "no frames attached"}
            </div>
          )}

          {/* The exact prompt text */}
          <pre className="text-[10px] leading-relaxed font-mono whitespace-pre-wrap break-words bg-muted/30 border border-border rounded p-2 max-h-72 overflow-y-auto scrollbar-thin">
            {r.prompt}
          </pre>
        </div>
      )}
    </div>
  );
}

export function PromptTab() {
  const a = useApp();
  const records = [...a.promptLog].reverse(); // newest first

  if (!records.length) {
    return (
      <div className="pt-8 text-center text-xs text-muted-foreground space-y-2">
        <FileText className="h-6 w-6 mx-auto opacity-40" />
        <p>No prompts yet.</p>
        <p>
          Ask in the chat or via <b>Listen</b> — the exact prompt and the frames
          sent to the model appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-2">
      {records.map((r, i) => (
        <RecordCard key={r.id} r={r} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
