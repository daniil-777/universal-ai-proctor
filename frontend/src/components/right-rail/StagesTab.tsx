import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  HelpCircle,
  Eye,
  Undo2,
  FileText,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
export function StagesTab() {
  const a = useApp();
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (a.currentStageId)
      setOpen((previous) => new Set([...previous, a.currentStageId]));
  }, [a.currentStageId]);
  const confirmed = a.stages.filter((s) => s.complete).length;
  if (!a.stages.length)
    return (
      <div className="pt-8 px-2 text-center">
        <div className="h-12 w-12 mx-auto bg-primary/10 rounded-2xl grid place-items-center">
          <ScanLine className="h-6 w-6 text-primary" />
        </div>
        <h2 className="mt-4 text-sm font-semibold">
          Your process steps appear here
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Upload a guidance document to extract key actions immediately. Without
          a document, start video or camera guidance to infer a provisional
          workflow.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-2"
          onClick={a.requestAnalysis}
          disabled={!a.videoUrl && !a.liveStream}
        >
          <Eye className="h-4 w-4" />
          Infer from current input
        </Button>
      </div>
    );
  return (
    <div className="space-y-3 pt-1">
      <div className="rounded-xl bg-primary/5 border border-primary/15 p-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold leading-snug break-words">
            {a.workflow.title}
          </h2>
          <Badge variant="outline" className="shrink-0 text-[10px]">
            {a.workflow.source === "inferred" ? "Provisional" : "Document"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Progress
            aria-label="Confirmed process steps"
            value={(confirmed / a.stages.length) * 100}
            className="h-1.5 flex-1"
          />
          <span className="text-[10px] tabular-nums shrink-0">
            {confirmed} / {a.stages.length} confirmed
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Progress reflects completion evidence. Confidence describes the
          model's self-reported observation, not a calibrated probability.
        </p>
      </div>
      {a.workflow.warnings.map((w) => (
        <p
          key={w}
          className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] text-warning leading-relaxed"
        >
          {w}
        </p>
      ))}
      {a.stages.map((s) => {
        const active = s.id === a.currentStageId;
        const expanded = open.has(s.id);
        return (
          <Collapsible
            key={s.id}
            open={expanded}
            onOpenChange={(value) =>
              setOpen((previous) => {
                const next = new Set(previous);
                if (value) next.add(s.id);
                else next.delete(s.id);
                return next;
              })
            }
          >
            <article
              data-testid={`step-${s.id}`}
              className={`rounded-xl border bg-card overflow-hidden transition-colors ${active ? "border-primary/70 shadow-sm shadow-primary/5" : "border-border"}`}
            >
              <CollapsibleTrigger
                className={`w-full flex items-start gap-2.5 p-3 text-left ${active ? "bg-primary/5" : ""}`}
              >
                <span
                  className={`h-7 w-7 grid place-items-center shrink-0 rounded-full text-xs font-semibold ${s.complete ? "bg-success text-white" : active ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}
                >
                  {s.complete ? <Check className="h-4 w-4" /> : s.index}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-snug break-words">
                    {s.name}
                  </div>
                  {s.complete && (
                    <span className="text-[10px] text-success">
                      {s.confirmation === "manual"
                        ? "Operator confirmed"
                        : "Evidence confirmed"}
                    </span>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                    {s.description}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Progress
                      aria-label={`${s.name} completion evidence`}
                      value={s.progress || 0}
                      className="h-1 flex-1"
                    />
                    <span className="text-[10px] tabular-nums">
                      {s.progress || 0}%
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="p-3 border-t space-y-3">
                  {s.objective && (
                    <div className="text-xs leading-relaxed">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">
                        Objective
                      </span>
                      {s.objective}
                    </div>
                  )}
                  {s.actions.length > 0 && (
                    <div>
                      <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                        Key actions
                      </h3>
                      <ol className="space-y-1.5 text-xs leading-relaxed">
                        {s.actions.map((action, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-primary shrink-0">
                              {i + 1}.
                            </span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {s.expectedInstruments.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      <b>Tools / equipment:</b>{" "}
                      {s.expectedInstruments.join(" · ")}
                    </div>
                  )}
                  <div>
                    <h3 className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                      Completion evidence
                    </h3>
                    <ul className="space-y-2">
                      {s.criteria.map((c) => (
                        <li key={c.key} className="flex gap-2 items-start">
                          {c.status === "met" ? (
                            <Check className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                          ) : c.status === "partial" ? (
                            <Eye className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />
                          ) : (
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          )}
                          <div>
                            <p className="text-xs leading-relaxed">{c.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                              <span
                                className={
                                  c.status === "not_met" ? "text-warning" : ""
                                }
                              >
                                {
                                  {
                                    unknown: "Not observed",
                                    partial: "Tentative evidence",
                                    met: "Confirmed",
                                    not_met: "Not met",
                                  }[c.status]
                                }
                              </span>
                              {c.evidence ? ` · ${c.evidence}` : ""}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex justify-between items-center gap-2 pt-2 border-t">
                    <span className="text-[10px] text-muted-foreground">
                      {s.confirmation === "manual"
                        ? "Confirmed by operator"
                        : s.lastObservedS === undefined
                          ? "Awaiting visual evidence"
                          : `Confidence: ${Math.round(s.confidence * 100)}%`}
                    </span>
                    <button
                      aria-label={`${s.complete ? "Reset" : "Confirm"} ${s.name} manually`}
                      className="text-[11px] font-medium text-primary hover:underline"
                      onClick={() =>
                        void a
                          .confirmStep(s.id, !s.complete)
                          .catch((error) => toast.error(String(error)))
                      }
                    >
                      {s.complete ? "Reset step" : "Confirm manually"}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </article>
          </Collapsible>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        className="w-full text-xs gap-2"
        onClick={() =>
          void a.resetProgress().catch((error) => toast.error(String(error)))
        }
      >
        <Undo2 className="h-3 w-3" />
        Reset progress
      </Button>
    </div>
  );
}
