import { BookOpen, Lightbulb } from "lucide-react";
import { useApp } from "@/lib/store";
export function PrinciplesTab() {
  const a = useApp();
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-primary" />
        Process principles
      </div>
      {a.lastAnalysis?.observation.principle && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
          <span className="text-[10px] uppercase tracking-wide text-primary">
            Current observation
          </span>
          <p className="text-xs leading-relaxed mt-2">
            {a.lastAnalysis.observation.principle}
          </p>
        </div>
      )}
      {a.workflow.principles.length ? (
        a.workflow.principles.map((p, i) => (
          <div key={i} className="rounded-xl border p-3 flex gap-2.5">
            <span className="text-primary mt-0.5">
              <Lightbulb className="h-4 w-4" />
            </span>
            <p className="text-xs leading-relaxed">{p}</p>
          </div>
        ))
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          Principles from your document appear here. With visual guidance,
          relevant principles are explained as the process is observed.
        </p>
      )}
    </div>
  );
}
