import { lazy, Suspense, useEffect } from "react";
import { IntroPage } from "@/components/IntroPage";
import { AppProvider, useApp } from "@/lib/store";

const loadWorkspace = () => import("@/components/Workspace");
const Workspace = lazy(loadWorkspace);

// Keep the video workbench out of the welcome page's initial download. Starting
// source setup warms the module while media and instructions are being loaded.
function Shell() {
  const a = useApp();
  useEffect(() => {
    if (a.sourceKind && !a.introDone) void loadWorkspace().catch(() => {});
  }, [a.sourceKind, a.introDone]);
  if (!a.introDone) return <IntroPage />;
  return (
    <Suspense fallback={<div className="min-h-screen bg-background grid place-items-center text-sm text-muted-foreground" role="status">Opening workspace…</div>}>
      <Workspace />
    </Suspense>
  );
}

const Index = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

export default Index;
