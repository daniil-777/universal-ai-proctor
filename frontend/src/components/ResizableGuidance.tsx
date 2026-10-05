import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { Grip } from "lucide-react";

type Size = { widthRatio: number; height: number };
const KEY = "process-guide-guidance-size-v1";
export function ResizableGuidance({ children, mobile, boundsRef }: { children: ReactNode; mobile: boolean; boundsRef: RefObject<HTMLDivElement> }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [size, setSize] = useState<Size | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && Number.isFinite(saved.widthRatio) && saved.widthRatio > 0 && saved.widthRatio <= 1 && Number.isFinite(saved.height) && saved.height >= 100
        ? saved : null;
    } catch { return null; }
  });
  const [bounds, setBounds] = useState({ width: Math.min(600, window.innerWidth - (mobile ? 0 : 24)), height: 320 });
  useEffect(() => {
    const parent = boundsRef.current;
    if (!parent) return;
    const measure = () => setBounds({ width: Math.max(1, parent.clientWidth - (mobile ? 0 : 24)), height: Math.max(128, Math.min(420, parent.clientHeight * 0.55)) });
    measure(); const observer = new ResizeObserver(measure); observer.observe(parent);
    return () => observer.disconnect();
  }, [boundsRef, mobile]);
  useEffect(() => {
    try { if (size) localStorage.setItem(KEY, JSON.stringify(size)); else localStorage.removeItem(KEY); }
    catch { /* Resizing also works when storage is unavailable. */ }
  }, [size]);
  const resize = (width: number, height: number) => setSize({
    widthRatio: Math.max(Math.min(270, bounds.width), Math.min(bounds.width, width)) / bounds.width,
    height: Math.max(128, Math.min(bounds.height, height)),
  });
  const start = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rect = box.current?.getBoundingClientRect(); if (!rect) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current; if (!from) return;
    e.preventDefault(); e.stopPropagation();
    resize(from.width + e.clientX - from.x, from.height + (e.clientY - from.y) * (mobile ? 1 : -1));
  };
  const keyboard = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Home") { setSize(null); return; }
    const rect = box.current?.getBoundingClientRect(); if (!rect) return;
    resize(rect.width + (e.key === "ArrowRight" ? 24 : e.key === "ArrowLeft" ? -24 : 0), rect.height + (e.key === "ArrowDown" ? 16 : e.key === "ArrowUp" ? -16 : 0));
  };
  return <div ref={box} className={`resizable-guidance ${mobile ? "relative shrink-0 self-start" : "absolute bottom-3 left-3"}`} data-resized={!!size}
    style={{ width: size ? Math.max(Math.min(270, bounds.width), Math.min(bounds.width, bounds.width * size.widthRatio)) : bounds.width,
      height: size ? Math.min(bounds.height, size.height) : undefined }}>
    {children}
    <button type="button" aria-label="Resize guidance area" title="Drag to change width and height. Arrow keys resize; double-click or Home resets."
      className={`guidance-resize-handle absolute ${mobile ? "bottom-0 cursor-nwse-resize" : "top-0 cursor-nesw-resize"} right-0 z-10 h-11 w-11 grid place-items-center rounded-xl bg-card/90 text-muted-foreground hover:text-primary touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
      onPointerDown={start} onPointerMove={move} onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={keyboard}
      onClick={e => { e.preventDefault(); e.stopPropagation(); }} onDoubleClick={() => setSize(null)}><Grip className="h-4 w-4" /></button>
  </div>;
}
