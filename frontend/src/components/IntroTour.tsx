import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { WalkthroughLauncher } from "./WalkthroughLauncher";
import { appAsset } from "@/lib/deployment";

const TOUR = appAsset("media/process-guide-tour.mp4");

export function IntroTour() {
  const video = useRef<HTMLVideoElement>(null);
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element || !requested || failed) return;
    // Muted playback is allowed on touch browsers; native controls remain available.
    void element.play().catch(() => {});
    const pauseHidden = () => {
      if (document.hidden) element.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      element.pause();
      observer.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [requested, failed]);

  return (
    <section className="intro-tour" aria-label="How to use Process Guide">
      <div className="intro-tour-heading">
        <span>See how it works</span>
        <span className="text-muted-foreground">20 seconds · silent</span>
      </div>
      <div className="intro-tour-screen">
        <video
          ref={video}
          data-testid="intro-tour-video"
          aria-label="Process Guide: choose a source, add optional guidance, review steps, and ask questions"
          src={requested && !failed ? TOUR : undefined}
          poster={appAsset("media/process-guide-tour.jpg")}
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
            aria-label="Play the 20-second app tour"
          >
            <span className="intro-tour-play-icon">
              <Play className="h-5 w-5" fill="currentColor" />
            </span>
            Play quick tour
          </button>
        )}
        {failed && (
          <div className="intro-tour-fallback" role="status">
            <p>
              The tour could not play. The setup steps below will get you
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
              <RotateCcw className="h-4 w-4" /> Retry tour
            </Button>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
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
