import { useRef, useState } from "react";
import {
  Camera,
  FileText,
  Film,
  Monitor,
  Play,
  Square,
  Plug,
  ScanLine,
  Loader2,
  Download,
  Eye,
  BookOpen,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { SampleDocumentSelect } from "./SampleDocumentSelect";
import { SampleVideoSelect } from "./SampleVideoSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReferenceTableDialog } from "./dialogs/ReferenceTableDialog";
import { ReferenceDocumentDialog } from "./dialogs/ReferenceDocumentDialog";
import { ReportLauncher } from "./ReportLauncher";
import { LogsDialog } from "./dialogs/LogsDialog";
import { CropDialog } from "./dialogs/CropDialog";
export function LeftRail() {
  const a = useApp();
  const file = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const live = async (screen = false) => {
    setCameraBusy(true);
    try {
      if (await a.startLiveVideo(screen ? "screen" : "camera")) {
        a.setVideoUrl(null);
        a.resetSource(
          screen ? "screen" : "camera",
          screen ? "Shared screen" : "Camera",
        );
        a.setRunning(true);
      }
    } finally {
      setCameraBusy(false);
    }
  };
  const start = () => {
    if (!a.videoUrl && !a.liveStream) {
      toast.message("Load a video or connect a camera first");
      return;
    }
    a.setRunning(!a.running);
    a.setMonitor({ active: !a.running });
    a.addLog({
      ts: Date.now(),
      level: "info",
      source: "System",
      msg: a.running ? "Guidance paused" : "Continuous guidance started",
    });
  };
  return (
    <aside className="h-full min-h-0 flex flex-col bg-card border-r">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <ScanLine className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Sources & setup</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
        <Accordion
          type="multiple"
          defaultValue={["source", "guidance", "observe"]}
        >
          <AccordionItem value="source">
            <AccordionTrigger className="text-sm">
              Input source
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => file.current?.click()}
              >
                <Film className="h-4 w-4" />
                Upload video
              </Button>
              <input
                data-testid="workspace-video-input"
                ref={file}
                hidden
                type="file"
                accept="video/*,.mkv,.m4v"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void a.loadVideo(f);
                  e.target.value = "";
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cameraBusy}
                  onClick={() => void live()}
                  className="gap-1"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Camera
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    cameraBusy || !navigator.mediaDevices?.getDisplayMedia
                  }
                  title={
                    !navigator.mediaDevices?.getDisplayMedia
                      ? "Screen sharing is unavailable on this device"
                      : "Share a screen"
                  }
                  onClick={() => void live(true)}
                  className="gap-1"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Screen
                </Button>
              </div>
              <SampleVideoSelect />
              {a.sourceName && (
                <p className="text-[11px] text-muted-foreground break-words">
                  {a.sourceName}
                  {a.uploading ? " · preparing clips" : ""}
                </p>
              )}
              {a.liveStream && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    a.stopLiveVideo();
                    a.setRunning(false);
                    a.setMonitor({ active: false });
                  }}
                >
                  Stop live input
                </Button>
              )}
              <div className="rounded-lg border border-dashed p-2.5 text-[11px] text-muted-foreground flex gap-2">
                <Plug className="h-4 w-4 shrink-0" />
                <div>
                  <b>Simulator · planned</b>
                  <p className="mt-1">
                    Reserved connection for a future adapter.
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="guidance">
            <AccordionTrigger className="text-sm">
              Guidance document
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                disabled={a.referenceLoading}
                className="w-full justify-start gap-2"
                onClick={() => doc.current?.click()}
              >
                {a.referenceLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Upload TXT / document
              </Button>
              <input
                data-testid="workspace-document-input"
                ref={doc}
                hidden
                type="file"
                accept=".txt,.md,.csv,.tsv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void a.loadGuidance(f);
                  e.target.value = "";
                }}
              />
              <SampleDocumentSelect
                label="Sample guidance"
                placeholder="Preserved guidance library"
              />
              <ReferenceDocumentDialog>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Read / edit document
                </Button>
              </ReferenceDocumentDialog>
              <ReferenceTableDialog>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                >
                  <Layers className="h-4 w-4" />
                  Edit extracted steps
                </Button>
              </ReferenceTableDialog>
              {a.referenceName && (
                <>
                  <p className="text-[11px] text-primary break-words">
                    {a.referenceName} · {a.stages.length} steps
                  </p>
                  <button
                    className="text-[11px] text-muted-foreground hover:text-primary"
                    onClick={() => void a.clearGuidance()}
                  >
                    Remove document · use visual guidance
                  </button>
                </>
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="observe">
            <AccordionTrigger className="text-sm">Observation</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Guardian notes</Label>
                <Switch
                  aria-label="Guardian notes"
                  checked={a.monitor.active}
                  onCheckedChange={(active) => a.setMonitor({ active })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Speak concerns</Label>
                <Switch
                  aria-label="Speak concerns"
                  checked={a.monitor.voiceOn}
                  onCheckedChange={(voiceOn) => a.setMonitor({ voiceOn })}
                />
              </div>
              <Label className="text-xs flex justify-between">
                Check interval<span>{a.monitor.intervalSecs}s</span>
              </Label>
              <Slider
                aria-label="Observation interval"
                value={[a.monitor.intervalSecs]}
                min={1}
                max={15}
                step={1}
                onValueChange={([intervalSecs]) =>
                  a.setMonitor({ intervalSecs })
                }
              />
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show guidance</Label>
                <Switch
                  aria-label="Show guidance"
                  checked={a.showGuidance}
                  onCheckedChange={a.setShowGuidance}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Process context</Label>
                <Switch
                  aria-label="Process context"
                  checked={a.patientInfoOn}
                  onCheckedChange={a.setPatientInfoOn}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Paused videos are checked once. Active input is sampled without
                overlapping requests.
              </p>
            </AccordionContent>
          </AccordionItem>
          {a.mode === "engineer" && (
            <AccordionItem value="processing">
              <AccordionTrigger className="text-sm">
                Processing controls
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <Select
                  value={a.analysis.method}
                  onValueChange={(method) =>
                    a.setAnalysis({ method: method as "Sampling" | "Mosaic" })
                  }
                >
                  <SelectTrigger aria-label="Frame processing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sampling">Frame sampling</SelectItem>
                    <SelectItem value="Mosaic">Frame mosaic</SelectItem>
                  </SelectContent>
                </Select>
                <Label className="text-xs flex justify-between">
                  Frames per check<span>{a.monitor.nFrames}</span>
                </Label>
                <Slider
                  value={[a.monitor.nFrames]}
                  min={1}
                  max={9}
                  step={1}
                  onValueChange={([nFrames]) => a.setMonitor({ nFrames })}
                />
                <Label className="text-xs flex justify-between">
                  Context window<span>{a.analysis.windowSecs}s</span>
                </Label>
                <Slider
                  value={[a.analysis.windowSecs]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([windowSecs]) => {
                    a.setAnalysis({ windowSecs });
                    a.setMonitor({ windowSecs });
                  }}
                />
                <div className="flex justify-between items-center">
                  <Label className="text-xs">Compress frames</Label>
                  <Switch
                    checked={a.analysis.compress}
                    onCheckedChange={(compress) => a.setAnalysis({ compress })}
                  />
                </div>
                <CropDialog />
                <p className="text-[11px] text-muted-foreground">
                  High detail preserves small visual cues. Compression or fewer
                  frames reduces data usage.
                </p>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
      <div className="p-3 border-t space-y-2">
        <Button className="w-full gap-2" onClick={start}>
          {a.running ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {a.running ? "Pause guidance" : "Start guidance"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <ReportLauncher>
            <Button variant="outline" size="sm">
              Report
            </Button>
          </ReportLauncher>
          <LogsDialog>
            <Button variant="outline" size="sm">
              Logs
            </Button>
          </LogsDialog>
        </div>
      </div>
    </aside>
  );
}
