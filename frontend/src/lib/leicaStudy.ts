import { useCallback, useEffect, useState, type RefObject } from "react";

export const LEICA_FILM_URL = "https://www.youtube.com/watch?v=p4t-OVIvuy8";
export const LEICA_EMBED_URL = "https://www.youtube-nocookie.com/embed/p4t-OVIvuy8?autoplay=1&playsinline=1&rel=0";
export const LEICA_GUIDE_FILENAME = "leica-m10-guidance.txt";

export const LEICA_STUDY_INTRO =
  "This Leica M10 study uses an observation guide. Watch the official film and review the six checkpoints. Ask a question by typing, or use Listen and begin with Hey or Hi. Describe what you observe; the guide can support questions without a shared image. For automatic visual analysis, share footage you have permission to process. A film edit does not prove a manufacturing step is complete, and hidden checks remain unknown.";

export function useLeicaPlayerRoom(player: RefObject<HTMLElement>, enabled = true) {
  const [narrow, setNarrow] = useState(false);
  const canPlay = useCallback(() => {
    const width = player.current?.getBoundingClientRect().width ?? 0;
    // A hidden disclosure and non-layout test environments measure zero.
    const tooSmall = width > 0 && width < 200;
    setNarrow(tooSmall);
    return !tooSmall;
  }, [player]);
  useEffect(() => {
    if (!enabled) return;
    const measure = () => { canPlay(); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (player.current) observer?.observe(player.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [player, enabled, canPlay]);
  return { narrow, canPlay };
}
