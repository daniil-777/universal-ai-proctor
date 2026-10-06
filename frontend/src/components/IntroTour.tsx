import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { WalkthroughLauncher } from "./WalkthroughLauncher";
import { appAsset } from "@/lib/deployment";

const TOUR = appAsset("media/cueveris-manufacturing-demo.mp4");

export function IntroTour({ paused = false }: { paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (paused) video.current?.pause();
  }, [paused]);

  useEffect(() => {
    const element = video.current;
    if (!element || !requested || failed) return;
    // Muted playback is allowed on touch browsers; native controls remain available.
    let active = true;
    void element.play().catch((error: unknown) => {
      if (active && !(error instanceof DOMException && error.name === "AbortError"))
        setFailed(true);
    });
    const pauseHidden = () => {
      if (document.hidden) element.pause();
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          if (entry && !entry.isIntersecting) element.pause();
        });
    observer?.observe(element);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      active = false;
      element.pause();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [requested, failed]);

  return (
    <section className="intro-tour" aria-label="Manufacturing guidance demonstration">
      <div className="intro-tour-heading">
        <span>See a process unfold</span>
        <span className="text-muted-foreground">30 seconds · manufacturing demo</span>
      </div>
      <div className="intro-tour-screen">
        <video
          ref={video}
          data-testid="intro-tour-video"
          aria-label="Manufacturing demonstration: follow the work, identify stages, and review the evidence"
          src={requested && !failed ? TOUR : undefined}
          poster={appAsset("media/cueveris-manufacturing-demo.jpg")}
          preload="none"
          muted
          playsInline
          controls={requested && !failed}
          onError={() => setFailed(true)}
        />
        {!requested && (
          <button
            className="intro-tour-play"
            onClick={() => setRequested(true)}
            aria-label="Play the 30-second manufacturing demo"
          >
            <span className="intro-tour-play-icon">
              <Play className="h-5 w-5" fill="currentColor" aria-hidden="true" />
            </span>
            Watch the demo
          </button>
        )}
        {failed && (
          <div className="intro-tour-fallback" role="status">
            <p>
              The demo could not play. The setup steps below will get you
              started.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setFailed(false);
                setRequested(true);
              }}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry demo
            </Button>
          </div>
        )}
      </div>
      <div className="intro-tour-actions">
        <a
          className="intro-tour-credits"
          href={appAsset("media/cueveris-manufacturing-demo.txt")}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Footage and credits, opens in a new tab"
        >
          Footage & credits
        </a>
        <WalkthroughLauncher
          className="w-full rounded-lg text-xs"
          onOpen={() => video.current?.pause()}
        />
        <p className="text-center text-[11px] text-muted-foreground">
          90 seconds · narrated · captions and chapters
        </p>
      </div>
      <details className="intro-tour-transcript">
        <summary>Read the quick-start guide</summary>
        <ol>
          <li>
            Choose a recorded video, connect your camera, or share a screen.
          </li>
          <li>
            Add a TXT, Markdown, or table document, or choose a sample. Without
            one, the guide starts with observations and provisional steps.
          </li>
          <li>
            Open the workspace. Review steps and principles on the right, watch
            Guardian notes, and ask questions by typing or using Listen.
          </li>
          <li>
            Check the evidence behind progress and review AI suggestions before
            acting.
          </li>
        </ol>
      </details>
    </section>
  );
}
