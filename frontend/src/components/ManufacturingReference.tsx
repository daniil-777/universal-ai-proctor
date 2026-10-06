import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Camera, Download, Loader2, Play, Plug } from "lucide-react";
import { useApp } from "@/lib/store";
import { appAsset, isStaticHosting } from "@/lib/deployment";
import { LEICA_EMBED_URL, LEICA_FILM_URL, LEICA_GUIDE_FILENAME, useLeicaPlayerRoom } from "@/lib/leicaStudy";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function ManufacturingReference({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const a = useApp();
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loadingGuide, setLoadingGuide] = useState(false);
  const [guideError, setGuideError] = useState("");
  const player = useRef<HTMLDivElement>(null);
  const previewNeedsBackend = isStaticHosting() && a.health?.ok !== true;
  const { narrow, canPlay } = useLeicaPlayerRoom(player, open);

  useEffect(() => {
    if (narrow) setPlaying(false);
  }, [narrow]);

  const openStudy = async () => {
    setLoadingGuide(true);
    setGuideError("");
    try {
      const response = await fetch(appAsset(`media/${LEICA_GUIDE_FILENAME}`));
      if (!response.ok) throw new Error("The Leica guide could not load. Please retry.");
      const text = await response.text();
      if (!text.trim()) throw new Error("The Leica guide is unavailable. Please retry.");
      a.setRunning(false);
      a.setMonitor({ active: false });
      a.stopLiveVideo();
      a.setVideoUrl(null);
      a.setAnalysis({ cropRect: undefined });
      // Reset server-owned media too: a guide-only question must never fall
      // back to sampling an earlier uploaded recording.
      await a.resetSource("screen", "Leica M10 guide — no shared input");
      const loaded = await a.loadGuidance(new File([text], LEICA_GUIDE_FILENAME, { type: "text/plain" }));
      if (!loaded) throw new Error("The guide could not be applied. Check the AI backend connection and retry.");
      a.setReferenceFilm("leica-m10");
      a.setCaseName("Leica M10 assembly study");
      setPlaying(false);
      a.setIntroDone(true);
    } catch (error) {
      setGuideError(error instanceof Error ? error.message : "The guide could not load. Please retry.");
    } finally {
      setLoadingGuide(false);
    }
  };

  useEffect(() => {
    if (!open || !playing) return;
    const stopHidden = () => {
      if (document.hidden) setPlaying(false);
    };
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          if (entry && !entry.isIntersecting) setPlaying(false);
        });
    if (player.current) observer?.observe(player.current);
    document.addEventListener("visibilitychange", stopHidden);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", stopHidden);
    };
  }, [open, playing]);

  return (
    <section className="intro-reference" aria-labelledby="manufacturing-reference-title">
      <div className="intro-reference-mark" aria-hidden="true">
        <Camera />
      </div>
      <div className="intro-reference-copy">
        <p className="intro-reference-eyebrow">A closer look at precision assembly</p>
        <h2 id="manufacturing-reference-title">Inside the Leica M10.</h2>
        <p>
          Apply a dedicated observation guide, then explore the film with the
          workspace’s steps, visual evidence and voice questions.
        </p>
        {guideError && <p className="intro-reference-error" role="alert">{guideError}</p>}
      </div>
      <div className="intro-reference-buttons">
        {previewNeedsBackend ? (
          <>
            <Button className="intro-reference-watch" onClick={() => window.dispatchEvent(new Event("guidance-connect-backend"))}>
              <Plug className="size-4" aria-hidden="true" /> Connect backend to use guide
            </Button>
            <p className="intro-reference-preview-note">Download the guide for the full app, or connect a backend to use it here.</p>
          </>
        ) : <Button className="intro-reference-watch" disabled={loadingGuide} onClick={() => void openStudy()}>
          {loadingGuide && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {loadingGuide ? "Loading guidance…" : guideError ? "Retry Leica guidance" : "Use Leica guidance"}
        </Button>}
        <a className="intro-reference-download" href={appAsset(`media/${LEICA_GUIDE_FILENAME}`)} download={LEICA_GUIDE_FILENAME}>
          <Download className="size-3.5" aria-hidden="true" /> Download Leica guide (.txt)
        </a>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setPlaying(false);
          onOpenChange?.(value);
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" className="intro-reference-watch">
            <Play className="size-4" aria-hidden="true" /> Watch official film
          </Button>
        </DialogTrigger>
        <DialogContent className="intro-reference-dialog max-w-4xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>Inside Leica M10 assembly</DialogTitle>
            <DialogDescription>
              An official film from Leica Camera. Watch the manufacturing process
              and look for its individual stages and checks.
            </DialogDescription>
          </DialogHeader>
          <div ref={player} className="intro-reference-player">
            {open && playing ? (
              <iframe
                src={LEICA_EMBED_URL}
                title="Official Leica Camera film: Leica M10 assembly"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="intro-reference-placeholder">
                <Camera className="size-10" aria-hidden="true" />
                <p>Leica M10 · Official manufacturing film</p>
                <Button
                  className="min-h-11 gap-2"
                  disabled={narrow}
                  onClick={() => { if (canPlay()) setPlaying(true); }}
                >
                  <Play className="size-4" aria-hidden="true" /> Play official Leica film
                </Button>
                <span>{narrow ? "This view is too narrow for the player. Open the original on YouTube below." : "YouTube loads when you press play."}</span>
              </div>
            )}
          </div>
          <div className="intro-reference-source">
            <a href={LEICA_FILM_URL} target="_blank" rel="noopener noreferrer">
              Open original on YouTube <ArrowUpRight className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p>If playback is unavailable, use the original film link.</p>
          </div>
          <p className="intro-reference-note">
            Official reference · Use Leica guidance to open a study workspace,
            review the checkpoints and ask questions from your own observations.
            For visual analysis, use footage you have permission to process. Cueveris is independent
            of Leica Camera; no endorsement is implied.
          </p>
        </DialogContent>
      </Dialog>
      </div>
    </section>
  );
}
