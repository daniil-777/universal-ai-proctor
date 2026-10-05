import { useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  FileText,
  Film,
  Loader2,
  Monitor,
  Plug,
  ShieldCheck,
  SunMoon,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { useAppearance } from "@/lib/useAppearance";
import { GuidanceGoals } from "./GuidanceGoals";
import { IntroTour } from "./IntroTour";
import { SampleDocumentSelect } from "./SampleDocumentSelect";
import { SampleVideoSelect } from "./SampleVideoSelect";
import { VideoLibraryLink } from "./VideoLibraryLink";
import { BackendConnectionNotice } from "./BackendConnectionNotice";
import "./intro.css";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Brand } from "./Brand";
export function IntroPage() {
  const a = useApp();
  const video = useRef<HTMLInputElement>(null);
  const document = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useAppearance();
  const camera = async (screen = false) => {
    setBusy(true);
    try {
      if (await a.startLiveVideo(screen ? "screen" : "camera")) {
        a.setVideoUrl(null);
        a.resetSource(
          screen ? "screen" : "camera",
          screen ? "Shared screen" : "Camera",
        );
      }
    } finally {
      setBusy(false);
    }
  };
  const enter = () => {
    a.setIntroDone(true);
    if (a.sourceKind) a.setRunning(true);
  };
  return (
    <div className="intro-page min-h-screen bg-background text-foreground">
      <header className="intro-header">
        <Brand />
        <div className="intro-header-tools">
          <span className="text-muted-foreground">Video · Camera · Screen</span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Toggle dark appearance"
            aria-pressed={dark}
            onClick={() => setDark(!dark)}
          >
            <SunMoon className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="intro-main">
        <BackendConnectionNotice />
        <div className="intro-hero">
          <div className="intro-hero-copy">
            <div className="intro-eyebrow">
              <span /> VIDEO & LIVE GUIDANCE
            </div>
            <h1>
              Watch the work.
              <br />
              Review the details.
            </h1>
            <p className="intro-description">
              Open a recording or connect a live view. Add instructions to track
              the process, review evidence and ask questions alongside the video.
            </p>
            <div className="mt-6 flex flex-col items-start gap-3">
              <VideoLibraryLink />
              <a className="intro-setup-link !mt-0" href="#session-setup">
                Set up your session <ArrowRight className="h-4 w-4" />
              </a>
            </div>
            <div className="intro-feature-list">
              <span>
                <Check /> Video or camera
              </span>
              <span>
                <Check /> Optional instructions
              </span>
              <span>
                <Check /> Steps & principles
              </span>
            </div>
          </div>
          <IntroTour />
        </div>
        <div className="intro-setup" id="session-setup">
          <div className="intro-section-title">
            <div>
              <div className="intro-eyebrow">YOUR WORKSPACE STARTS HERE</div>
              <h2>Start a guidance session.</h2>
            </div>
            <p>Choose a source, instructions and guidance preferences.</p>
          </div>
          <div className="intro-step-heading">
            <span>1</span>
            <h3>Choose your view</h3>
          </div>
          <section
            className="grid md:grid-cols-3 gap-4"
            aria-label="Choose a source"
          >
            {[
              {
                id: "video",
                icon: <Film />,
                title: "Upload a video",
                body: "Play, pause and inspect any recorded process.",
                action: () => video.current?.click(),
              },
              {
                id: "camera",
                icon: <Camera />,
                title: "Use your camera",
                body: "Follow a process as it happens, with live guidance.",
                action: () => void camera(),
              },
              {
                id: "screen",
                icon: <Monitor />,
                title: "Share a screen",
                body: "Guide software workflows or a shared video feed.",
                action: () => void camera(true),
              },
            ].map((card) => (
              <button
                key={card.id}
                aria-pressed={a.sourceKind === card.id}
                disabled={
                  busy ||
                  (card.id === "screen" &&
                    !navigator.mediaDevices?.getDisplayMedia)
                }
                onClick={card.action}
                className={`intro-source-card text-left border p-5 transition-colors hover:border-primary/60 hover:bg-primary/5 ${a.sourceKind === card.id ? "border-primary bg-primary/5" : "bg-card border-border"}`}
              >
                <span className="h-10 w-10 grid place-items-center rounded-xl bg-primary/10 text-primary mb-4">
                  {card.icon}
                </span>
                <div className="font-semibold text-sm flex items-center gap-2">
                  {card.title}
                  {a.sourceKind === card.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground mt-2">
                  {card.id === "screen" &&
                  !navigator.mediaDevices?.getDisplayMedia
                    ? "Screen sharing is unavailable here. Use a video or camera."
                    : card.body}
                </p>
              </button>
            ))}
          </section>
          <input
            data-testid="intro-video-input"
            ref={video}
            type="file"
            accept="video/*,.mkv,.m4v"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void a.loadVideo(f);
              e.target.value = "";
            }}
          />
          <div className="mt-4 max-w-xl rounded-xl border bg-card p-4">
            <SampleVideoSelect />
          </div>
          <input
            data-testid="intro-document-input"
            ref={document}
            type="file"
            accept=".txt,.md,.csv,.tsv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void a.loadGuidance(f);
              e.target.value = "";
            }}
          />
          {a.sourceName && (
            <div className="mt-3 text-xs text-primary flex items-center gap-2">
              <Check className="h-3.5 w-3.5" />
              {a.sourceName}
              {a.uploading && (
                <span className="text-muted-foreground">
                  · preparing server copy for clips
                </span>
              )}
            </div>
          )}
          <div className="intro-step-heading mt-7">
            <span>2</span>
            <h3>
              Add your instructions <small>Optional</small>
            </h3>
          </div>
          <section className="intro-document rounded-2xl border bg-card p-5 flex flex-col md:flex-row gap-5 items-start md:items-center">
            <div className="flex gap-3 flex-1">
              <div className="h-10 w-10 shrink-0 grid place-items-center bg-muted rounded-xl text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">
                  Add a guidance document{" "}
                  <span className="font-normal text-muted-foreground">
                    · optional
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  Key actions become editable steps on the right. Completion
                  criteria and principles stay alongside your video.
                </p>
                {a.referenceName && (
                  <p className="mt-2 text-xs font-medium text-primary">
                    {a.referenceName} · {a.stages.length} steps extracted
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 w-full md:w-56">
              <Button
                variant="outline"
                disabled={a.referenceLoading}
                onClick={() => document.current?.click()}
                className="gap-2"
              >
                {a.referenceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Upload guidance
              </Button>
              <SampleDocumentSelect
                label="Choose a sample guidance document"
                placeholder="Choose a sample document"
              />
              {a.referenceName && (
                <button
                  className="text-xs text-muted-foreground hover:text-primary"
                  onClick={() => void a.clearGuidance()}
                >
                  Continue without a document
                </button>
              )}
            </div>
          </section>
          <div className="intro-step-heading mt-7">
            <span>3</span>
            <h3>Set your guidance</h3>
          </div>
          <div className="intro-preferences flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div className="text-xs">
                <b>Guardian observation</b>
                <p className="text-muted-foreground mt-1">
                  Scene notes and evidence-based concerns.
                </p>
              </div>
              <Switch
                aria-label="Enable Guardian"
                checked={a.monitor.active}
                onCheckedChange={(active) => a.setMonitor({ active })}
              />
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Guidance level</span>
              <Select
                value={a.experience}
                onValueChange={(level) =>
                  a.setExperience(level as typeof a.experience)
                }
              >
                <SelectTrigger className="w-36" aria-label="Guidance level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Beginner", "Intermediate", "Expert"].map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                What do you want from your guide?
              </p>
              <p className="mt-1 text-xs text-muted-foreground break-words line-clamp-2">
                {a.operatorGoals ||
                  "Add your wishes for focus, explanations, or language."}
              </p>
            </div>
            <GuidanceGoals />
          </div>
          <div className="intro-launch mt-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Plug className="h-3.5 w-3.5" />
              <span>Simulator connection reserved for a future release.</span>
            </div>
            <Button
              className="h-11 px-6 gap-2 rounded-xl shrink-0 w-full sm:w-auto"
              onClick={enter}
              disabled={busy || a.referenceLoading}
            >
              Open workspace
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          {!a.sourceKind && (
            <p className="text-right mt-2 text-xs text-muted-foreground">
              You can add a source inside the workspace.
            </p>
          )}
        </div>
        <footer className="intro-footer">
          Observe carefully. Review the evidence. Stay in control.
        </footer>
      </main>
    </div>
  );
}
