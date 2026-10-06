import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { lazy, Suspense, useState, useEffect, useRef, type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_GUIDANCE_TEXT_SIZE, MIN_GUIDANCE_TEXT_SIZE, clampSize } from "@/lib/workspaceSizing";
import { useApp } from "@/lib/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StagesTab } from "./right-rail/StagesTab";
import { RawJsonDrawer } from "./right-rail/RawJsonDrawer";
const Principles = lazy(() =>
  import("./right-rail/PrinciplesTab").then((m) => ({
    default: m.PrinciplesTab,
  })),
);
const Guardian = lazy(() =>
  import("./right-rail/GuardianTab").then((m) => ({ default: m.GuardianTab })),
);
const Metrics = lazy(() =>
  import("./right-rail/MetricsTab").then((m) => ({ default: m.MetricsTab })),
);
import { LogsTab as Logs } from "./right-rail/LogsTab";
const Prompt = lazy(() =>
  import("./right-rail/PromptTab").then((m) => ({ default: m.PromptTab })),
);
const Params = lazy(() =>
  import("./right-rail/ParamsTab").then((m) => ({ default: m.ParamsTab })),
);
const Compare = lazy(() =>
  import("./right-rail/CompareTab").then((m) => ({ default: m.CompareTab })),
);
const Review = lazy(() => import("./right-rail/ReviewTab").then(m => ({ default: m.ReviewTab })));
const Readiness = lazy(() => import("./right-rail/ReadinessTab").then(m => ({ default: m.ReadinessTab })));

export type GuidanceSizingControls = {
  widthPx: number; heightPx: number; textSizePx: number;
  minWidthPx: number; maxWidthPx: number; minHeightPx: number; maxHeightPx: number;
  onWidthChange: (value: number) => void; onHeightChange: (value: number) => void;
  onTextSizeChange: (value: number) => void; onReset: () => void;
};

function SizeField({ id, label, value, min, max, onChange }: {
  id: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const cancelOnBlur = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    if (cancelOnBlur.current) { cancelOnBlur.current = false; setDraft(String(value)); return; }
    const number = Number(draft);
    const next = draft.trim() && Number.isFinite(number) ? clampSize(number, min, max) : value;
    onChange(next); setDraft(String(next));
  };
  return <div className="guidance-size-field">
    <div className="guidance-size-field-label"><label htmlFor={id}>{label}</label><span>{min}–{max}</span></div>
    <div className="guidance-size-field-controls">
      <input type="range" min={min} max={max} step={1} value={value} aria-label={`${label.replace(" (px)", "")} slider`}
        onChange={event => onChange(Number(event.target.value))} />
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft}
        onFocus={() => { editing.current = true; }} onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); cancelOnBlur.current = true;
            editing.current = false; setDraft(String(value)); event.currentTarget.blur();
          }
        }} />
    </div>
  </div>;
}

export function RightRail({ sizing }: { sizing?: GuidanceSizingControls }) {
  const a = useApp();
  const compact = useMediaQuery("(max-width: 1279px)");
  const [selected, setSelected] = useState("stages");
  useEffect(() => {
    if (selected === "compare" && a.mode !== "engineer") setSelected("stages");
  }, [a.mode, selected]);
  const tabs = [
    { id: "stages", name: "Steps", element: <StagesTab /> },
    { id: "principles", name: "Principles", element: <Principles /> },
    { id: "guardian", name: "Guardian", element: <Guardian /> },
    { id: "review", name: "Review", element: <Review /> },
    { id: "readiness", name: "Readiness", element: <Readiness /> },
    { id: "metrics", name: "Metrics", element: <Metrics /> },
    ...(a.mode === "engineer"
      ? [{ id: "compare", name: "Compare", element: <Compare /> }]
      : []),
    { id: "prompt", name: "Prompts", element: <Prompt /> },
    { id: "logs", name: "Logs", element: <Logs /> },
    { id: "params", name: "Params", element: <Params /> },
  ];
  return (
    <aside className="guidance-rail h-full min-h-0 flex flex-col bg-card border-l" aria-label="Guidance and instructions"
      data-guidance-text-size={sizing?.textSizePx || 14}
      style={{ "--guidance-text-size": `${(sizing?.textSizePx || 14) / 16}rem` } as CSSProperties}>
      {sizing && <div className="guidance-sizing-toolbar">
        <div><b>Guidance</b><span>{sizing.textSizePx}px text</span></div>
        <Popover>
          <PopoverTrigger className="guidance-sizing-trigger" aria-label="Adjust guidance size">
            <SlidersHorizontal aria-hidden="true" /><span>Size & text</span>
          </PopoverTrigger>
          <PopoverContent align="end" className="guidance-sizing-popover">
            <div className="guidance-sizing-heading"><b>Make room for the details</b><p>Drag the dividers or enter an exact size.</p></div>
            <SizeField id="guidance-width" label="Guidance width (px)" value={sizing.widthPx} min={sizing.minWidthPx} max={sizing.maxWidthPx} onChange={sizing.onWidthChange} />
            <SizeField id="guidance-height" label="Guidance height (px)" value={sizing.heightPx} min={sizing.minHeightPx} max={sizing.maxHeightPx} onChange={sizing.onHeightChange} />
            <SizeField id="guidance-text-size" label="Guidance text size (px)" value={sizing.textSizePx} min={MIN_GUIDANCE_TEXT_SIZE} max={MAX_GUIDANCE_TEXT_SIZE} onChange={sizing.onTextSizeChange} />
            <p className="guidance-sizing-note">Text wraps inside the instructions. Your sizes are saved on this device.</p>
            <button className="guidance-sizing-reset" onClick={sizing.onReset}><RotateCcw aria-hidden="true" />Reset layout and text</button>
          </PopoverContent>
        </Popover>
      </div>}
      <Tabs
        value={selected}
        onValueChange={setSelected}
        className="h-full min-h-0 flex flex-col"
      >
        <TabsList className="m-2 workspace-tabs justify-start h-auto">
          {(compact ? tabs.slice(0, 3) : tabs).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
              {tab.name}
            </TabsTrigger>
          ))}
          {compact && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex items-center justify-center gap-1 rounded-sm text-xs"
                aria-label="More guidance tools"
              >
                {tabs.slice(3).find((t) => t.id === selected)?.name || "More"}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {tabs.slice(3).map((tab) => (
                  <DropdownMenuItem
                    key={tab.id}
                    onSelect={() => setSelected(tab.id)}
                  >
                    {tab.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            aria-label={tab.name}
            className={`flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-3 m-0 ${["stages", "principles", "guardian", "review", "readiness"].includes(tab.id) ? "guidance-reading" : ""}`}
          >
            <Suspense
              fallback={
                <p className="p-3 text-xs text-muted-foreground">Loading…</p>
              }
            >
              {tab.element}
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
      {a.mode === "engineer" && <RawJsonDrawer />}
    </aside>
  );
}
