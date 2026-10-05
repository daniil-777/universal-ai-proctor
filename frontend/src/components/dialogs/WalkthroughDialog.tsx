import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { appAsset } from "@/lib/deployment";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const MEDIA = appAsset("media/process-guide-walkthrough");
interface Chapter {
  id: string;
  title: string;
  start_s: number;
  end_s: number;
}
interface TranscriptLine {
  start_s: number;
  end_s: number;
  text: string;
}
interface Walkthrough {
  title: string;
  duration_s: number;
  language: string;
  captions_burned_in?: boolean;
  chapters: Chapter[];
  transcript: TranscriptLine[];
}

function readMetadata(value: unknown): Walkthrough {
  const data = value as Partial<Walkthrough> | null;
  if (
    !data ||
    typeof data.title !== "string" ||
    typeof data.language !== "string" ||
    !Number.isFinite(data.duration_s) ||
    data.duration_s! <= 0 ||
    data.duration_s! > 3600 ||
    !Array.isArray(data.chapters) ||
    !data.chapters.length ||
    data.chapters.length > 30 ||
    !Array.isArray(data.transcript) ||
    !data.transcript.length ||
    data.transcript.length > 300
  )
    throw new Error("Walkthrough information is unavailable.");
  const validTimes = (row: { start_s: number; end_s: number }) =>
    Number.isFinite(row?.start_s) &&
    Number.isFinite(row?.end_s) &&
    row.start_s >= 0 &&
    row.end_s > row.start_s &&
    row.end_s <= data.duration_s! + 0.1;
  if (
    data.chapters.some(
      (row) =>
        !validTimes(row) ||
        typeof row.id !== "string" ||
        typeof row.title !== "string",
    ) ||
    data.transcript.some(
      (row) => !validTimes(row) || typeof row.text !== "string",
    )
  )
    throw new Error("Walkthrough information is unavailable.");
  return data as Walkthrough;
}
const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function WalkthroughDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const transcript = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(false);
  const attempt = useRef(0);
  const resumeAt = useRef(0);
  const [metadata, setMetadata] = useState<Walkthrough | null>(null);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const [requested, setRequested] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(0);
  const [media, setMedia] = useState<HTMLVideoElement | null>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    video.current = element;
    setMedia(element);
  }, []);
  const invalidatePlayback = useCallback(() => ++attempt.current, []);

  const release = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.hasAttribute("src") && Number.isFinite(element.currentTime))
      resumeAt.current = element.currentTime;
    invalidatePlayback();
    element.pause();
    element.removeAttribute("src");
    element.load();
    setRequested(false);
    setPlaying(false);
    setPosition(resumeAt.current);
  }, [invalidatePlayback]);

  useEffect(() => {
    if (!media) return;
    mounted.current = true;
    let active = true;
    const element = media;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    void fetch(`${MEDIA}.json`, {
      signal: controller.signal,
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Walkthrough information is unavailable.");
        return readMetadata(await response.json());
      })
      .then((data) => {
        if (active && !controller.signal.aborted) setMetadata(data);
      })
      .catch(() => {
        if (active) setMetadataFailed(true);
      })
      .finally(() => clearTimeout(timer));
    const pauseHidden = () => {
      if (document.hidden && element.hasAttribute("src")) release();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            if (entry && !entry.isIntersecting && element.hasAttribute("src"))
              release();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      mounted.current = false;
      active = false;
      invalidatePlayback();
      controller.abort();
      clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [media, release, invalidatePlayback]);

  const play = () => {
    const element = video.current;
    if (!element) return;
    // On a phone, opening from a scrolled Settings dialog can leave the player
    // above the visible body. Bring it into view before starting so the offscreen
    // observer does not immediately release the source after the user's click.
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const ticket = invalidatePlayback();
    setFailed(false);
    setError("");
    setRequested(true);
    // A single imperative source owner preserves the click gesture and avoids restarting pending playback on render.
    if (!element.hasAttribute("src")) {
      element.src = `${MEDIA}.mp4`;
      element.load();
    }
    element.muted = false;
    void element.play().catch(() => {
      if (!mounted.current || ticket !== attempt.current) return;
      setPlaying(false);
      setFailed(true);
      setError(
        "Playback could not start. Try again or read the transcript below.",
      );
    });
  };
  const seek = (seconds: number) => {
    resumeAt.current = seconds;
    setPosition(seconds);
    if (video.current?.hasAttribute("src") && video.current.readyState >= 1) {
      const duration = video.current.duration;
      video.current.currentTime = Number.isFinite(duration)
        ? Math.min(seconds, Math.max(0, duration - 0.1))
        : seconds;
    }
  };
  const showTranscript = () => {
    if (!transcript.current) return;
    transcript.current.open = true;
    transcript.current.scrollIntoView?.({ block: "nearest" });
    transcript.current.querySelector("summary")?.focus();
  };
  const currentChapter = metadata?.chapters.find(
    (chapter) => position >= chapter.start_s && position < chapter.end_s,
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="workspace-professional-dialog workspace-walkthrough-dialog flex max-w-5xl max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl"
        style={{ padding: 0 }}
      >
        <DialogHeader className="shrink-0 border-b bg-card px-4 py-5 text-left sm:px-6">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.18em] text-primary">
            Process Guide / Getting started
          </p>
          <DialogTitle className="pr-10 text-xl font-semibold tracking-tight">
            Process Guide walkthrough
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            90 seconds · narrated · English captions. See the actual controls,
            from setup to saved results.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 scrollbar-thin sm:p-6">
          <div className="overflow-hidden rounded-xl border bg-slate-950">
            <video
              ref={attachVideo}
              data-testid="walkthrough-video"
              aria-label="Narrated Process Guide app walkthrough"
              className="aspect-video w-full object-contain"
              poster={`${MEDIA}-poster.jpg`}
              preload="none"
              playsInline
              controls={requested}
              onPlay={(event) => {
                if (!event.currentTarget.hasAttribute("src")) return;
                setPlaying(true);
                setFailed(false);
                setError("");
              }}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                if (
                  !event.currentTarget.hasAttribute("src") ||
                  event.currentTarget.readyState < 1
                )
                  return;
                resumeAt.current = event.currentTarget.currentTime;
                setPosition(event.currentTarget.currentTime);
              }}
              onLoadedMetadata={(event) => {
                if (
                  event.currentTarget.hasAttribute("src") &&
                  resumeAt.current > 0 &&
                  Number.isFinite(event.currentTarget.duration)
                )
                  event.currentTarget.currentTime = Math.min(
                    resumeAt.current,
                    Math.max(0, event.currentTarget.duration - 0.1),
                  );
              }}
              onError={(event) => {
                if (!event.currentTarget.hasAttribute("src")) return;
                release();
                setFailed(true);
                setError(
                  "The walkthrough could not play. Retry or use the narrated transcript below.",
                );
              }}
            >
              {requested && (
                <track
                  kind="captions"
                  label="English"
                  srcLang="en"
                  src={`${MEDIA}.vtt`}
                  default={metadata?.captions_burned_in === false}
                />
              )}
            </video>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button
              className="min-h-11 rounded-lg text-xs"
              onClick={() => (playing ? video.current?.pause() : play())}
            >
              {failed ? (
                <RotateCcw className="size-4" aria-hidden="true" />
              ) : playing ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              {failed
                ? "Retry walkthrough"
                : playing
                  ? "Pause narrated walkthrough"
                  : "Play narrated walkthrough"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {timestamp(position)} / {timestamp(metadata?.duration_s || 90)} ·
              Sound plays after you press Play
            </p>
          </div>
          {error && (
            <div
              className="mt-3 rounded-xl border border-warning/25 bg-warning/5 p-3 text-xs leading-relaxed"
              role="alert"
            >
              <p>{error}</p>
              <Button
                className="mt-2 min-h-11 px-2 text-xs"
                variant="ghost"
                onClick={showTranscript}
              >
                Read transcript
              </Button>
            </div>
          )}
          <section className="mt-6" aria-label="Walkthrough chapters">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-sm font-semibold">Jump to a chapter</h3>
              <p className="text-[11px] text-muted-foreground">
                Choose a point, then press Play.
              </p>
            </div>
            {!metadata && (
              <p
                className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
                role="status"
              >
                {!metadataFailed && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {metadataFailed
                  ? "Chapter timings are unavailable. The video and written guide are still available."
                  : "Loading chapters and transcript…"}
              </p>
            )}
            {metadata && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {metadata.chapters.map((chapter) => (
                  <button
                    key={chapter.id}
                    className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-3 text-left text-xs transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${currentChapter?.id === chapter.id ? "border-primary/35 bg-primary/5" : "bg-card"}`}
                    aria-current={
                      currentChapter?.id === chapter.id ? "step" : undefined
                    }
                    onClick={() => seek(chapter.start_s)}
                  >
                    <span className="shrink-0 font-medium tabular-nums text-primary">
                      {timestamp(chapter.start_s)}
                    </span>
                    <span className="min-w-0 leading-relaxed">
                      {chapter.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <details
            ref={transcript}
            className="group mt-5 rounded-xl border bg-card"
          >
            <summary className="min-h-11 cursor-pointer p-4 text-xs font-medium">
              Transcript and written guide
            </summary>
            <div className="space-y-4 border-t p-4">
              {metadata ? (
                metadata.transcript.map((line, index) => (
                  <div
                    key={index}
                    className="flex gap-3 text-xs leading-relaxed"
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {timestamp(line.start_s)}
                    </span>
                    <p className="min-w-0 whitespace-pre-wrap break-words">
                      {line.text}
                    </p>
                  </div>
                ))
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {metadataFailed
                      ? "The narration transcript could not load. This written setup guide remains available."
                      : "The narration transcript is loading. This written setup guide remains available."}
                  </p>
                  <ol className="list-decimal space-y-2 pl-4 text-xs leading-relaxed">
                    <li>
                      Choose Upload a video, Use camera or Share screen. Add an
                      optional guidance document or select a sample.
                    </li>
                    <li>
                      Open the workspace. Follow the actions and principles on
                      the right, and check the evidence behind progress.
                    </li>
                    <li>
                      Use Guardian for recorded observations. Ask questions by
                      typing or using Listen, and add your wishes to shape
                      guidance.
                    </li>
                    <li>
                      Review the recorded evidence and unresolved issues.
                      Prepare a report or save the current result to your
                      account.
                    </li>
                  </ol>
                </>
              )}
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
