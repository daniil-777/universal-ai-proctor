import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Loader2, Monitor, Play, Volume2 } from "lucide-react";
import { useApp } from "@/lib/store";
import { LEICA_EMBED_URL, LEICA_FILM_URL, LEICA_STUDY_INTRO, useLeicaPlayerRoom } from "@/lib/leicaStudy";
import { interruptAnswers, speak } from "@/lib/speech";
import { Button } from "./ui/button";
import "./leica-study.css";

export function LeicaWorkspaceReference() {
  const a = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const connected = !!a.liveStream && a.sourceKind === "screen";
  const canShare = !!navigator.mediaDevices?.getDisplayMedia;
  const { narrow, canPlay } = useLeicaPlayerRoom(player, a.referenceFilm === "leica-m10");

  useEffect(() => {
    if (narrow) setPlaying(false);
  }, [narrow]);

  useEffect(() => {
    if (a.referenceFilm !== "leica-m10") setPlaying(false);
  }, [a.referenceFilm]);

  useEffect(() => {
    if (!playing) return;
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
  }, [playing]);

  if (a.referenceFilm !== "leica-m10") return null;

  const share = async () => {
    setBusy(true);
    setError("");
    try {
      if (!await a.startLiveVideo("screen")) return;
      a.setVideoUrl(null);
      await a.resetSource("screen", "Shared view — Leica M10 assembly study");
      a.setRunning(false);
      a.setMonitor({ active: false });
      setPlaying(false);
      if (disclosure.current) disclosure.current.open = false;
    } catch (problem) {
      a.stopLiveVideo();
      setError(problem instanceof Error ? problem.message : "The shared tab could not connect. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="leica-study" aria-labelledby="leica-study-title">
      <div className="leica-study-heading">
        <div>
          <p className="leica-study-eyebrow">Guided film study</p>
          <h2 id="leica-study-title">Leica M10 assembly</h2>
        </div>
        <span className={`leica-study-status ${connected ? "is-connected" : ""}`} role="status">
          {connected ? "Shared input connected" : "Guide loaded · film not shared"}
        </span>
      </div>
      <p className="leica-study-instructions">
        Watch the official film and review the guide. Ask text or voice questions
        using your own observations. For automatic visual analysis, share footage
        you have permission to process.
      </p>
      <div className="leica-study-actions">
        <a className="leica-study-source" href={LEICA_FILM_URL} target="_blank" rel="noopener noreferrer">
          Open YouTube film <ArrowUpRight className="size-3.5" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <Button variant="outline" className="min-h-11 gap-2" disabled={busy || !canShare} onClick={() => void share()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Monitor className="size-4" aria-hidden="true" />}
          {busy ? "Connecting…" : connected ? "Choose another authorized view" : "Share authorized footage"}
        </Button>
        <Button variant="ghost" className="min-h-11 gap-2" onClick={() => {
          interruptAnswers();
          speak(a.apiBase, LEICA_STUDY_INTRO);
        }}>
          <Volume2 className="size-4" aria-hidden="true" /> Hear study instructions
        </Button>
      </div>
      {!canShare && <p className="leica-study-note">Tab sharing is unavailable in this browser. Watch the film and review the guide, or open the workspace in a browser that supports screen sharing.</p>}
      {error && <p className="leica-study-error" role="alert">{error}</p>}
      <p className="leica-study-note">
        {connected
          ? "Check that the shared view shows the footage you’re authorized to process. Select Analyze current view, review the Steps panel, then use Listen to ask “Hey, what is visible here?” and hear the answer."
          : "The guide is ready. Ask questions from your own observations without sharing the film. Visual checks require an authorized shared view and an analysis request."}
      </p>
      {connected && a.liveStream?.getVideoTracks()[0]?.label && (
        <p className="leica-study-note">Selected view: {a.liveStream.getVideoTracks()[0].label}</p>
      )}
      <details ref={disclosure} className="leica-study-film" onToggle={event => {
        if (!event.currentTarget.open) setPlaying(false);
      }}>
        <summary>Watch the official film here</summary>
        <div ref={player} className="leica-study-player">
          {playing ? (
            <iframe
              src={LEICA_EMBED_URL}
              title="Official Leica Camera film in the study workspace"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="leica-study-placeholder">
              <p>Leica Camera · Official M10 film</p>
              <Button className="min-h-11 gap-2" disabled={narrow} onClick={() => { if (canPlay()) setPlaying(true); }}>
                <Play className="size-4" aria-hidden="true" /> Play official film in workspace
              </Button>
              {narrow && <p>This view is too narrow for the player. Use the original YouTube film link above.</p>}
            </div>
          )}
        </div>
        <p className="leica-study-note">This official player is a viewing reference. If playback is unavailable, the original film link remains available. Use footage you have permission to process for visual analysis.</p>
      </details>
      <p className="leica-study-attribution">Official source: Leica Camera · Independent study; no Leica endorsement.</p>
    </section>
  );
}
