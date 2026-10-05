import { useId } from "react";
import { ArrowUpRight, Clapperboard } from "lucide-react";
import { appAsset } from "@/lib/deployment";

export function VideoLibraryLink() {
  const id = useId();
  return (
    <a
      href={appAsset("media/process-guide-real-scenarios/index.html")}
      target="_blank"
      rel="noopener noreferrer"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="group flex min-h-16 w-full items-center gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-fit"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <Clapperboard className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-sm font-semibold leading-snug">
          Videos &amp; instructions
        </span>
        <span id={`${id}-description`} className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          5 real processes · videos + TXT guides
          <span className="sr-only">. Opens in a new tab.</span>
        </span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
    </a>
  );
}
