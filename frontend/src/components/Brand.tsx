import { Activity } from "lucide-react";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand flex items-center gap-2.5 shrink-0">
      <div className="brand-mark h-9 w-9 grid place-items-center rounded-xl bg-gradient-to-br from-primary to-teal-400 text-white shadow-lg shadow-teal-900/15">
        <Activity className="h-5 w-5" />
      </div>
      {!compact && (
        <div className="brand-copy min-w-0">
          <div className="font-semibold text-sm tracking-tight truncate">
            Process Guide
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Observe. Understand. Progress.
          </div>
        </div>
      )}
    </div>
  );
}
