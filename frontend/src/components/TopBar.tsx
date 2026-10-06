import { lazy, Suspense, useEffect, useState } from "react";
import {
  Activity,
  HelpCircle,
  Settings,
  Square,
  Video,
  Plug,
  SunMoon,
  PanelLeft,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { MODELS } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { GuidanceGoals } from "./GuidanceGoals";
import { Brand } from "./Brand";
import { useAppearance } from "@/lib/useAppearance";
import { WalkthroughLauncher } from "./WalkthroughLauncher";
const AccountDialog = lazy(() => import("./dialogs/AccountDialog"));
export function TopBar({
  sourcesOpen = false,
  onSourcesToggle,
}: {
  sourcesOpen?: boolean;
  onSourcesToggle?: () => void;
}) {
  const a = useApp();
  const [dark, setDark] = useAppearance();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!a.recordStart) {
      setElapsed(0);
      return;
    }
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - a.recordStart!) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [a.recordStart]);
  return (
    <header className="workspace-header theme-header bg-card text-foreground shrink-0 border-b border-border px-4 py-3 flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="icon"
        className="sources-toggle h-11 w-11"
        aria-label="Sources and setup"
        aria-controls="sources-panel"
        aria-expanded={sourcesOpen}
        onClick={onSourcesToggle}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <Brand />
      <div className="hidden xl:block w-px h-8 bg-border" />
      <div className="hidden xl:block flex-1 min-w-0 max-w-72">
        <label
          className="text-[10px] text-muted-foreground"
          htmlFor="session-title"
        >
          Session
        </label>
        <Input
          id="session-title"
          value={a.caseName}
          onChange={(e) => a.setCaseName(e.target.value)}
          className="h-6 p-0 border-0 bg-transparent text-xs"
        />
      </div>
      <div className="flex-1" />
      <div className="desktop-controls flex items-center rounded-lg border p-0.5">
        {[
          { value: "surgeon", label: "Guide" },
          { value: "engineer", label: "Engineer" },
        ].map((mode) => (
          <button
            key={mode.value}
            onClick={() => a.setMode(mode.value as typeof a.mode)}
            className={`rounded-md px-3 py-1.5 text-xs ${a.mode === mode.value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <Select
        value={a.model.model_id}
        onValueChange={(id) => {
          const model = MODELS.find((m) => m.model_id === id);
          if (model) {
            a.setModel(model);
            a.setMonitor({
              provider: model.provider,
              modelId: model.model_id,
              display: model.display,
            });
          }
        }}
      >
        <SelectTrigger
          aria-label="AI model"
          className="desktop-controls h-9 w-40 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((m) => (
            <SelectItem key={m.model_id} value={m.model_id}>
              {m.display}
              {a.health?.providers?.[m.provider] === false
                ? " · setup needed"
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={a.experience}
        onValueChange={(level) => a.setExperience(level as typeof a.experience)}
      >
        <SelectTrigger
          aria-label="Experience level"
          className="desktop-controls h-9 w-32 text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["Beginner", "Intermediate", "Expert"].map((level) => (
            <SelectItem value={level} key={level}>
              {level}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="hidden lg:flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className={`h-1.5 w-1.5 rounded-full ${a.health?.ok ? "bg-success" : "bg-warning"}`}
        />
        {a.useMock || a.health?.mock
          ? "Demo mode"
          : a.referenceFilm && !a.liveStream
            ? "Film study · not shared"
          : a.sourceKind === "camera" || a.sourceKind === "screen"
            ? "Live input"
            : a.sourceKind
              ? "Video ready"
              : "No source"}
      </span>
      <Button
        aria-label={a.recording ? "Stop recording" : "Record session"}
        size="sm"
        variant={a.recording ? "destructive" : "outline"}
        onClick={a.toggleRecording}
        className="h-9 gap-2"
      >
        {a.recording ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-destructive" />
        )}
        <span className="record-label">
          {a.recording ? `${elapsed}s` : "Record"}
        </span>
      </Button>
      <GuidanceGoals compact />
      <Suspense fallback={null}>
        <AccountDialog />
      </Suspense>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            className="h-9 w-9"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Workspace settings</DialogTitle>
            <DialogDescription>
              Configure the workspace and processing mode.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="compact-controls space-y-3">
              <div className="flex gap-2">
                <Button
                  onClick={() => a.setMode("surgeon")}
                  variant={a.mode === "surgeon" ? "default" : "outline"}
                >
                  Guide
                </Button>
                <Button
                  onClick={() => a.setMode("engineer")}
                  variant={a.mode === "engineer" ? "default" : "outline"}
                >
                  Engineer
                </Button>
              </div>
              <Label>AI model</Label>
              <Select
                value={a.model.model_id}
                onValueChange={(id) => {
                  const m = MODELS.find((m) => m.model_id === id);
                  if (m) {
                    a.setModel(m);
                    a.setMonitor({
                      provider: m.provider,
                      modelId: m.model_id,
                      display: m.display,
                    });
                  }
                }}
              >
                <SelectTrigger aria-label="AI model in settings">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.model_id} value={m.model_id}>
                      {m.display}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Guidance level</Label>
              <Select
                value={a.experience}
                onValueChange={(v) => a.setExperience(v as typeof a.experience)}
              >
                <SelectTrigger aria-label="Experience level in settings">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Beginner", "Intermediate", "Expert"].map((v) => (
                    <SelectItem value={v} key={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Visual detail</Label>
              <Select
                value={a.analysis.visionDetail}
                onValueChange={(v) =>
                  a.setAnalysis({
                    visionDetail: v as "auto" | "low" | "high",
                    compress: v !== "high",
                  })
                }
              >
                <SelectTrigger aria-label="Visual detail">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Balanced · automatic detail
                  </SelectItem>
                  <SelectItem value="high">
                    Detailed · small objects and text
                  </SelectItem>
                  <SelectItem value="low">
                    Fast · broad scene observations
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Detailed mode captures up to 1280 px. It can take longer and use
                more image tokens.
              </p>
            </div>

            <div>
              <Label>API base URL</Label>
              <Input
                value={a.apiBase}
                onChange={(e) => a.setApiBase(e.target.value)}
              />
            </div>
            <div className="flex justify-between items-center">
              <div>
                <Label>Demo mode</Label>
                <p className="text-xs text-muted-foreground">
                  Use the interface without making AI requests. No visual
                  progress is inferred.
                </p>
              </div>
              <Switch
                aria-label="Demo mode"
                checked={a.useMock}
                onCheckedChange={a.setUseMock}
              />
            </div>
            <div className="flex justify-between items-center">
              <Label>Dark appearance</Label>
              <Switch
                aria-label="Dark appearance"
                checked={dark}
                onCheckedChange={setDark}
              />
            </div>
            <div className="rounded-lg border p-3 text-xs text-muted-foreground">
              <Plug className="h-4 w-4 mb-2" />
              <b>Simulator adapter · planned</b>
              <p className="mt-1">
                Video and camera guidance work independently. A telemetry
                adapter can be developed later.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Provider credentials stay in backend/.env. AI suggestions require
              operator verification.
            </p>
            <div className="compact-controls border-t pt-4">
              <p className="mb-2 text-xs font-medium">Getting started</p>
              <WalkthroughLauncher className="w-full rounded-lg text-xs" />
              <p className="mt-2 text-[11px] text-muted-foreground">
                90-second narrated guide · captions and chapters
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Help"
            className="h-9 w-9"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Using Cueveris</DialogTitle>
            <DialogDescription>
              Load a video, camera or screen, then add an optional guidance
              document.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-primary/5 p-4">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              A guided tour of the actual setup, guidance, evidence and account
              controls.
            </p>
            <WalkthroughLauncher
              className="w-full rounded-lg text-xs"
              variant="default"
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              90 seconds · narrated · English captions
            </p>
          </div>
          <div className="text-sm space-y-3">
            <p>
              The right panel extracts actions and principles from your
              document. Without a document, visual steps are provisional and
              editable.
            </p>
            <p>
              Progress is separate from model confidence. Completed criteria
              need repeat visual evidence or explicit operator confirmation.
            </p>
            <p>
              Space: play/pause · arrows: frame step · R: record. Drag panel
              dividers or the corner of Guardian messages to resize.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
