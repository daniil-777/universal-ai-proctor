import { useEffect } from "react";

/** Keep floating UI inside the visible screen when a touch keyboard opens. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let scheduled = 0;
    const update = () => {
      scheduled = 0;
      const height = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-visible-height", `${height}px`);
      root.style.setProperty("--app-visible-top", `${viewport?.offsetTop ?? 0}px`);
      root.dataset.compactViewport = String(height < 500);
      // Pinch zoom also changes the visual viewport; it is not a keyboard.
      root.dataset.virtualKeyboard = String(
        (viewport?.scale ?? 1) < 1.1 && window.innerHeight - height > 150,
      );
    };
    const schedule = () => {
      if (!scheduled) scheduled = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.style.removeProperty("--app-visible-height");
      root.style.removeProperty("--app-visible-top");
      delete root.dataset.compactViewport;
      delete root.dataset.virtualKeyboard;
    };
  }, []);
}
