import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { GripHorizontal, GripVertical, X } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { TopBar } from "@/components/TopBar";
import { LeftRail } from "@/components/LeftRail";
import { VideoStage } from "@/components/VideoStage";
import { LeicaWorkspaceReference } from "@/components/LeicaWorkspaceReference";
import { RightRail } from "@/components/RightRail";
import { ChatDock } from "@/components/ChatDock";
import { DeveloperCredit } from "@/components/DeveloperCredit";
import { BackendConnectionNotice } from "@/components/BackendConnectionNotice";
import { useMediaQuery } from "@/hooks/use-mobile";
import { clampSize, DEFAULT_WORKSPACE_SIZING, readWorkspaceSizing, saveWorkspaceSizing, workspaceSizingBounds, type WorkspaceSizing } from "@/lib/workspaceSizing";
import "./workspace-sizing.css";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

function HeightResizeHandle({ label, testId, value, min, max, onChange, onReset, axis = "y", reverse = false, editor = false, onDragging }: {
  label: string; testId: string; value: number; min: number; max: number;
  onChange: (value: number) => void; onReset: () => void;
  axis?: "x" | "y"; reverse?: boolean; editor?: boolean; onDragging?: (value: boolean) => void;
}) {
  const drag = useRef<{ position: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const stop = () => {
    if (!drag.current) return;
    drag.current = null; setDragging(false); onDragging?.(false);
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { position: axis === "x" ? event.clientX : event.clientY, size: value };
    setDragging(true); onDragging?.(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return <div
    className={editor ? "workspace-editor-divider" : "workspace-height-divider"}
    data-testid={testId}
    data-resize-handle-state={dragging ? "drag" : "inactive"}
    role="separator"
    aria-label={label}
    aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={`${value} pixels`}
    tabIndex={0}
    title={`${label}. Drag or use ${axis === "x" ? "Left and Right" : "Up and Down"}. Double-click to reset.`}
    onPointerDown={start}
    onPointerMove={event => {
      if (!drag.current) return;
      event.preventDefault(); event.stopPropagation();
      const movement = (axis === "x" ? event.clientX : event.clientY) - drag.current.position;
      onChange(clampSize(drag.current.size + movement * (reverse ? -1 : 1), min, max));
    }}
    onPointerUp={stop}
    onPointerCancel={stop}
    onLostPointerCapture={stop}
    onDoubleClick={onReset}
    onKeyDown={event => {
      const delta = event.shiftKey ? 40 : 10;
      const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
      const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
      const next = event.key === decrease ? value - delta * (reverse ? -1 : 1) : event.key === increase ? value + delta * (reverse ? -1 : 1)
        : event.key === "Home" ? min : event.key === "End" ? max : undefined;
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation(); onChange(clampSize(next, min, max));
    }}
  >{editor ? <div>{axis === "x" ? <GripVertical aria-hidden="true" /> : <GripHorizontal aria-hidden="true" />}</div>
    : <><GripHorizontal aria-hidden="true" /><span aria-hidden="true">Drag to resize</span></>}</div>;
}

export default function Workspace() {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 1279px)");
  const stacked = useMediaQuery("(max-width: 767px) and (orientation: portrait)");
  const touch = useMediaQuery("(pointer: coarse)");
  const [sizing, setSizing] = useState(readWorkspaceSizing);
  const [panelLayout, setPanelLayout] = useState([65, 35]);
  const [room, setRoom] = useState({ width: Math.max(320, window.innerWidth - 220), height: Math.max(300, window.innerHeight - 130) });
  const editorHost = useRef<HTMLDivElement>(null);
  const guidance = useRef<ImperativePanelHandle>(null);
  const draggingDivider = useRef(false);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const handleHeight = touch ? 44 : 24;
  const maxEditorHeight = Math.max(1, room.height - handleHeight);
  const minEditorHeight = Math.min(stacked ? 400 : 220, maxEditorHeight);
  const editorHeight = clampSize(sizing.editorHeightPx || maxEditorHeight, minEditorHeight, maxEditorHeight);
  const editorBodyHeight = Math.max(1, editorHeight - (stacked ? (touch ? 44 : 24) : 0));
  const editorBodyWidth = Math.max(1, room.width - (stacked ? 0 : touch ? 24 : 12));
  const bounds = workspaceSizingBounds(editorBodyWidth, editorBodyHeight, stacked);
  const guidanceWidth = clampSize(sizing.guidanceWidthPx, bounds.minWidth, bounds.maxWidth);
  const maximumGuidanceHeight = Math.max(1, bounds.maxHeight - (stacked ? 0 : handleHeight));
  const minimumGuidanceHeight = Math.min(bounds.minHeight, maximumGuidanceHeight);
  const guidanceHeight = clampSize(sizing.guidanceHeightPx || (stacked ? editorBodyHeight * .44 : maximumGuidanceHeight), minimumGuidanceHeight, maximumGuidanceHeight);
  const updateSizing = (values: Partial<WorkspaceSizing>) => setSizing(previous => ({ ...previous, ...values }));
  const rememberDivider = () => {
    const percentage = guidance.current?.getSize();
    if (percentage === undefined) return;
    updateSizing(stacked ? { guidanceHeightPx: Math.round(percentage * editorBodyHeight / 100) }
      : { guidanceWidthPx: Math.round(percentage * editorBodyWidth / 100) });
  };

  useEffect(() => { saveWorkspaceSizing(sizing); }, [sizing]);
  useEffect(() => {
    const element = editorHost.current;
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      const width = element.clientWidth; const height = element.clientHeight;
      setRoom(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; measure(); });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    window.addEventListener("resize", schedule);
    return () => { observer?.disconnect(); window.removeEventListener("resize", schedule); if (frame !== null) cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => {
    if (draggingDivider.current) return;
    guidance.current?.resize(stacked ? 100 * guidanceHeight / editorBodyHeight : 100 * guidanceWidth / editorBodyWidth);
  }, [stacked, guidanceHeight, guidanceWidth, editorBodyHeight, editorBodyWidth]);
  useEffect(() => {
    if (!compact) setSourcesOpen(false);
  }, [compact]);
  useEffect(() => {
    if (!sourcesOpen) return;
    const previous = document.activeElement as HTMLElement;
    sourcesRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".workspace-header, .workspace-video, .workspace-guidance, .workspace-editor-divider, .workspace-height-divider, .workspace-footer, .chat-panel, .chat-launcher",
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
  return (
    <div className="workspace-shell workspace-sizing flex flex-col bg-background text-foreground">
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
        className="workspace-layout flex-1 min-h-0"
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
        <ResizableHandle withHandle className="workspace-divider workspace-source-divider" aria-label="Resize sources panel" />
        <ResizablePanel
          className="workspace-content"
          defaultSize={80}
          minSize={50}
        >
          <div ref={editorHost} className="workspace-editor-host">
            <div className="workspace-editor-extent" style={{ height: editorHeight }} data-testid="workspace-editor-extent">
              <ResizablePanelGroup direction={stacked ? "vertical" : "horizontal"} className="workspace-editor-group" keyboardResizeBy={2}
                onLayout={setPanelLayout} style={{ "--workspace-video-flex": panelLayout[0], "--workspace-guidance-flex": panelLayout[1] } as CSSProperties}>
                <ResizablePanel className="workspace-video" id="workspace-video-panel" defaultSize={65}
                  minSize={100 * (stacked ? bounds.minVideoHeight / editorBodyHeight : bounds.minVideoWidth / editorBodyWidth)}>
                  <div className="workspace-video-content flex h-full min-h-0 flex-col">
                    <LeicaWorkspaceReference />
                    <div className="flex-1 min-h-0"><VideoStage editorSizing={{ heightPx: editorHeight, minHeightPx: minEditorHeight, maxHeightPx: maxEditorHeight,
                      onHeightChange: value => updateSizing({ editorHeightPx: clampSize(value, minEditorHeight, maxEditorHeight) }),
                      onReset: () => updateSizing({ editorHeightPx: 0 }) }} /></div>
                  </div>
                </ResizablePanel>
                <HeightResizeHandle editor label="Resize video and guidance" testId="workspace-editor-divider" axis={stacked ? "y" : "x"} reverse
                  value={stacked ? guidanceHeight : guidanceWidth} min={stacked ? minimumGuidanceHeight : bounds.minWidth}
                  max={stacked ? maximumGuidanceHeight : bounds.maxWidth}
                  onDragging={value => { draggingDivider.current = value; if (!value) rememberDivider(); }}
                  onReset={() => updateSizing(stacked ? { guidanceHeightPx: 0 } : { guidanceWidthPx: DEFAULT_WORKSPACE_SIZING.guidanceWidthPx })}
                  onChange={value => {
                    guidance.current?.resize(100 * value / (stacked ? editorBodyHeight : editorBodyWidth));
                    updateSizing(stacked ? { guidanceHeightPx: value } : { guidanceWidthPx: value });
                  }} />
                <ResizablePanel className="workspace-guidance" id="workspace-guidance-panel" ref={guidance} defaultSize={35}
                  minSize={100 * (stacked ? minimumGuidanceHeight / editorBodyHeight : bounds.minWidth / editorBodyWidth)}
                  onResize={percentage => {
                    if (draggingDivider.current) updateSizing(stacked ? { guidanceHeightPx: Math.round(percentage * editorBodyHeight / 100) }
                      : { guidanceWidthPx: Math.round(percentage * editorBodyWidth / 100) });
                  }}>
                  <div className="workspace-guidance-size-box" style={{ width: stacked ? guidanceWidth : "100%", height: stacked ? "100%" : guidanceHeight }}>
                    <RightRail sizing={{ widthPx: guidanceWidth, heightPx: guidanceHeight, textSizePx: sizing.textSizePx,
                      minWidthPx: bounds.minWidth, maxWidthPx: bounds.maxWidth, minHeightPx: minimumGuidanceHeight, maxHeightPx: maximumGuidanceHeight,
                      onWidthChange: value => updateSizing({ guidanceWidthPx: clampSize(value, bounds.minWidth, bounds.maxWidth) }),
                      onHeightChange: value => updateSizing({ guidanceHeightPx: clampSize(value, minimumGuidanceHeight, maximumGuidanceHeight) }),
                      onTextSizeChange: value => updateSizing({ textSizePx: value }),
                      onReset: () => setSizing({ ...DEFAULT_WORKSPACE_SIZING }) }} />
                  </div>
                  {!stacked && <HeightResizeHandle label="Resize guidance height" testId="guidance-height-divider" value={guidanceHeight}
                    min={minimumGuidanceHeight} max={maximumGuidanceHeight}
                    onChange={value => updateSizing({ guidanceHeightPx: value })} onReset={() => updateSizing({ guidanceHeightPx: 0 })} />}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            <HeightResizeHandle label="Resize video editor height" testId="workspace-editor-height-divider" value={editorHeight}
              min={minEditorHeight} max={maxEditorHeight} onChange={value => updateSizing({ editorHeightPx: value })}
              onReset={() => updateSizing({ editorHeightPx: 0 })} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <footer className="workspace-footer"><DeveloperCredit /></footer>
      <ChatDock />
    </div>
  );
};
