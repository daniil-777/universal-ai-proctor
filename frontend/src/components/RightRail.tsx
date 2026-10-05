import { ChevronDown } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { lazy, Suspense, useState, useEffect } from "react";
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
export function RightRail() {
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
    <aside className="h-full min-h-0 flex flex-col bg-card border-l">
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
            className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 pb-3 m-0"
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
