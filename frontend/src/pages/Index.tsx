import { useEffect, useRef, useState } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { X } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { LeftRail } from "@/components/LeftRail";
import { VideoStage } from "@/components/VideoStage";
import { RightRail } from "@/components/RightRail";
import { ChatDock } from "@/components/ChatDock";
import { IntroPage } from "@/components/IntroPage";
import { BackendConnectionNotice } from "@/components/BackendConnectionNotice";
import { AppProvider, useApp } from "@/lib/store";
import { useMediaQuery } from "@/hooks/use-mobile";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

// Inside the provider so the intro writes straight into the shared store
// (experience level, source, Guardian) and the main window picks it all up.
const Shell = () => {
  const a = useApp();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 1279px)");
  const sourcesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compact) setSourcesOpen(false);
  }, [compact]);
  useEffect(() => {
    if (!sourcesOpen) return;
    const previous = document.activeElement as HTMLElement;
    sourcesRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".workspace-header, .workspace-video, .workspace-guidance, .chat-panel, .chat-launcher",
      ),
    );
    background.forEach((element) => { element.inert = true; });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setSourcesOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      background.forEach((element) => { element.inert = false; });
      previous?.focus();
    };
  }, [sourcesOpen]);
  if (!a.introDone) return <IntroPage />;
  return (
    <div className="workspace-shell flex flex-col bg-background text-foreground">
      <TopBar
        sourcesOpen={sourcesOpen}
        onSourcesToggle={() => setSourcesOpen((open) => !open)}
      />
      <div className="empty:hidden px-3 py-2"><BackendConnectionNotice /></div>
      {sourcesOpen && (
        <button
          className="source-backdrop"
          aria-label="Close sources panel"
          tabIndex={-1}
          onClick={() => setSourcesOpen(false)}
        />
      )}
      <ResizablePanelGroup
        direction="horizontal"
        className="responsive-workspace flex-1 min-h-0"
        data-sources-open={sourcesOpen}
      >
        <ResizablePanel
          className="workspace-sources"
          defaultSize={20}
          minSize={14}
          maxSize={32}
          collapsible
        >
          <FocusScope
            asChild
            loop={sourcesOpen}
            trapped={sourcesOpen}
            onMountAutoFocus={(event) => event.preventDefault()}
            onUnmountAutoFocus={(event) => event.preventDefault()}
          >
            <div
              ref={sourcesRef}
              className="h-full min-h-0 flex flex-col"
              id="sources-panel"
              role={sourcesOpen ? "dialog" : undefined}
              aria-modal={sourcesOpen || undefined}
              aria-labelledby={sourcesOpen ? "sources-title" : undefined}
            >
              <div className="source-drawer-header flex items-center justify-between px-4 py-2 border-b bg-card">
                <b className="text-sm" id="sources-title">Sources & setup</b>
                <button
                  aria-label="Close sources"
                  onClick={() => setSourcesOpen(false)}
                  className="grid place-items-center h-11 w-11"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <LeftRail />
              </div>
            </div>
          </FocusScope>
        </ResizablePanel>
        <ResizableHandle withHandle className="workspace-divider" />
        <ResizablePanel
          className="workspace-video"
          defaultSize={55}
          minSize={30}
        >
          <VideoStage />
        </ResizablePanel>
        <ResizableHandle withHandle className="workspace-divider" />
        <ResizablePanel
          className="workspace-guidance"
          defaultSize={25}
          minSize={18}
          maxSize={40}
          collapsible
        >
          <RightRail />
        </ResizablePanel>
      </ResizablePanelGroup>
      <ChatDock />
    </div>
  );
};

const Index = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

export default Index;
