import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Camera, Play } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

const YOUTUBE_URL = "https://www.youtube.com/watch?v=p4t-OVIvuy8";
const EMBED_URL = "https://www.youtube-nocookie.com/embed/p4t-OVIvuy8?autoplay=1&playsinline=1&rel=0";

export function ManufacturingReference({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLDivElement>(null);

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
          Watch Leica Camera’s official film for a real-world view of careful
          assembly and inspection.
        </p>
      </div>
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
                src={EMBED_URL}
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
                  onClick={() => setPlaying(true)}
                >
                  <Play className="size-4" aria-hidden="true" /> Play official Leica film
                </Button>
                <span>YouTube loads when you press play.</span>
              </div>
            )}
          </div>
          <div className="intro-reference-source">
            <a href={YOUTUBE_URL} target="_blank" rel="noopener noreferrer">
              Open original on YouTube <ArrowUpRight className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <p>If playback is unavailable, use the original film link.</p>
          </div>
          <p className="intro-reference-note">
            Watch-only reference · For a guidance session, choose a library video
            or upload footage you have permission to use. Cueveris is independent
            of Leica Camera; no endorsement is implied.
          </p>
        </DialogContent>
      </Dialog>
    </section>
  );
}
