import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { useApp } from "@/lib/store";
export function RawJsonDrawer() {
  const a = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-xs text-muted-foreground flex justify-between"
      >
        <span>Observation JSON</span>
        <ChevronUp className={`h-3.5 w-3.5 ${open ? "" : "rotate-180"}`} />
      </button>
      {open && (
        <pre className="text-[10px] p-3 max-h-52 overflow-auto bg-muted/30">
          {JSON.stringify(
            a.lastAnalysis?.observation || {
              workflow: a.workflow,
              observation: null,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
