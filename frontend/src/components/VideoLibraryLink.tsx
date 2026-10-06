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
      className="intro-library-link group"
    >
      <span className="intro-library-icon">
        <Clapperboard className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span id={`${id}-title`} className="block text-sm font-medium leading-snug">
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
