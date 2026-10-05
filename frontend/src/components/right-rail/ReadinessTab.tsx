import { useEffect, useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReadinessTab() {
  const a = useApp();
  const [job, setJob] = useState({ work_order: "", asset: "", operator: "" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>(
    {},
  );
  const identity = `${a.sourceId}|${a.review?.reference_key}`;
  const owner = useRef(identity);
  owner.current = identity;
  useEffect(() => {
    setDirty(false);
    setError("");
    setPendingChecks({});
  }, [identity]);
  const toggle = async (id: string, checked: boolean) => {
    const context = identity;
    setPendingChecks((p) => ({ ...p, [id]: checked }));
    try {
      await a.saveReadiness({ checks: [{ id, checked }] });
      if (owner.current === context) setError("");
    } catch (e) {
      if (owner.current === context && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    } finally {
      if (owner.current === context)
        setPendingChecks((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
    }
  };
  useEffect(() => {
    if (a.review && !dirty) setJob(a.review.job);
  }, [a.review, dirty]);
  const checked = a.review?.checks.filter((i) => i.checked).length || 0;
  return (
    <div className="space-y-4 pt-2">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="size-4 text-primary" /> Job readiness
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          Preparation and context for this run.
        </p>
      </div>
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-xs space-y-2">
        <p className="break-words">
          <span className="text-muted-foreground">Input · </span>
          {a.sourceName || "No input connected"}
        </p>
        <p className="break-words">
          <span className="text-muted-foreground">Instructions · </span>
          {a.referenceName || "Visual guidance without a document"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {a.workflow.source === "inferred"
            ? "Visually inferred steps are provisional."
            : "Confirm the input and instructions match the job."}
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const context = identity;
          void a
            .saveReadiness({ job })
            .then(() => {
              if (owner.current === context) {
                setDirty(false);
                setError("");
              }
            })
            .catch((e) => {
              if (owner.current === context && e.name !== "AbortError")
                setError(e.message);
            });
        }}
      >
        {(
          [
            ["work_order", "Work order"],
            ["asset", "Asset / workstation"],
            ["operator", "Operator name"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-xs">
            {label}
            <Input
              className="mt-1"
              value={job[key]}
              maxLength={key === "operator" ? 120 : 160}
              onChange={(e) => {
                setJob((j) => ({ ...j, [key]: e.target.value }));
                setDirty(true);
              }}
            />
          </label>
        ))}
        <Button size="sm" disabled={!a.review || a.reviewBusy || !dirty}>
          Save job context
        </Button>
      </form>
      {(error || a.reviewError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || a.reviewError}
        </p>
      )}
      <div>
        <div className="flex justify-between gap-2 text-xs font-medium">
          <span>Operator preparation checks</span>
          <span>
            {checked}/{a.review?.checks.length || 0}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Suggested from the tools and principles in your instructions. Confirm
          each yourself.
        </p>
      </div>
      <div className="space-y-2">
        {a.review?.checks.map((item) => (
          <label
            key={item.id}
            className="flex gap-3 rounded-xl border p-3 cursor-pointer text-xs leading-relaxed min-h-12"
          >
            <input
              className="mt-1 shrink-0 accent-teal-600 size-4"
              type="checkbox"
              checked={pendingChecks[item.id] ?? item.checked}
              disabled={a.reviewBusy || a.referenceLoading}
              onChange={(e) => void toggle(item.id, e.target.checked)}
            />
            <span className="min-w-0 break-words">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground block">
                {item.kind === "tool" ? "Tool / material" : "Principle"}
              </span>
              {item.label}
              {item.checked && (
                <span className="text-[10px] text-muted-foreground block mt-1">
                  Checked by {item.checked_by || "operator"}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      {!a.review?.checks.length && (
        <p className="text-xs text-muted-foreground">
          Upload instructions to extract preparation checks. Video-only and
          camera-only guidance remain available.
        </p>
      )}
      <p className="rounded-xl border p-3 text-[11px] text-muted-foreground leading-relaxed">
        {a.review?.notice ||
          "Preparation checks are operator records. They do not verify hidden conditions or confirm workflow completion."}
      </p>
    </div>
  );
}
