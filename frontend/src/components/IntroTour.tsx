import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";
import { WalkthroughLauncher } from "./WalkthroughLauncher";
import { appAsset } from "@/lib/deployment";

const TOUR = appAsset("media/cueveris-leica-workflow-demo.mp4");

export function IntroTour({ paused = false }: { paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const playAttempt = useRef(0);
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);

  const playDemo = () => {
    const element = video.current;
    if (!element) return;
    // Commit the lazy source before play, within the same user gesture. Updating
    // src after play would reload the element and interrupt audible playback.
    flushSync(() => {
      setFailed(false);
      setSoundBlocked(false);
      setRequested(true);
    });
    const attempt = ++playAttempt.current;
    element.muted = false;
    void element.play().catch((error: unknown) => {
      if (attempt !== playAttempt.current) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        element.muted = true;
        setSoundBlocked(true);
        void element.play().catch((retryError: unknown) => {
          if (attempt === playAttempt.current && !(retryError instanceof DOMException && retryError.name === "AbortError")) setFailed(true);
        });
      } else setFailed(true);
    });
  };

  useEffect(() => {
    if (paused) {
      playAttempt.current++;
      video.current?.pause();
    }
  }, [paused]);

  useEffect(() => {
    const element = video.current;
    if (!element || !requested || failed) return;
    const stop = () => {
      playAttempt.current++;
      element.pause();
    };
    const pauseHidden = () => {
      if (document.hidden) stop();
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          if (entry && !entry.isIntersecting) stop();
        });
    observer?.observe(element);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, [requested, failed]);

  return (
    <section className="intro-tour" aria-label="Leica study and voice demonstration">
      <div className="intro-tour-heading">
        <span>See the Leica study in action</span>
        <span className="text-muted-foreground">63 seconds · UI & voice demo</span>
      </div>
      <div className="intro-tour-screen">
        <video
          ref={video}
          data-testid="intro-tour-video"
          aria-label="Cueveris Leica M10 study: apply a six-step guide, review evidence, ask questions and hear voice answers"
          src={requested && !failed ? TOUR : undefined}
          poster={appAsset("media/cueveris-leica-workflow-demo.jpg")}
          preload="none"
          muted={!requested || soundBlocked}
          playsInline
          controls={requested && !failed}
          onError={() => setFailed(true)}
        >
          <track
            kind="captions"
            label="English"
            srcLang="en"
            src={requested && !failed ? appAsset("media/cueveris-leica-workflow-demo.vtt") : undefined}
          />
        </video>
        {!requested && (
          <button
            className="intro-tour-play"
            onClick={playDemo}
            aria-label="Play 63-second Leica UI and voice demo"
          >
            <span className="intro-tour-play-icon">
              <Play className="h-5 w-5" fill="currentColor" aria-hidden="true" />
            </span>
            Play UI & voice demo
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
              onClick={playDemo}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry demo
            </Button>
          </div>
        )}
      </div>
      <div className="intro-tour-actions">
        <p className="text-center text-[11px] text-muted-foreground">
          {soundBlocked ? "Sound was blocked. Use the player’s sound control to hear the voice demo." : "Includes spoken answers · sound and captions in player controls"}
        </p>
        <a
          className="intro-tour-credits"
          href={appAsset("media/cueveris-leica-workflow-demo.txt")}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Demo transcript and credits, opens in a new tab"
        >
          Transcript & credits
        </a>
        <WalkthroughLauncher
          className="w-full rounded-md text-xs"
          onOpen={() => {
            playAttempt.current++;
            video.current?.pause();
          }}
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
