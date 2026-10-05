import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode, RefObject } from "react";
import { Grip } from "lucide-react";
import { cn } from "@/lib/utils";

interface GuardianMessageResizeProps {
  children: ReactNode;
  storageKey: string;
  label: string;
  width: number;
  className?: string;
  boundsRef?: RefObject<HTMLElement>;
  centered?: boolean;
}

// Scale the whole message so its text, icons and box keep the same proportions.
export function GuardianMessageResize({
  children,
  storageKey,
  label,
  width,
  className,
  boundsRef,
  centered = false,
}: GuardianMessageResizeProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  } | null>(null);
  const [scale, setScale] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 0.6 ? Math.min(3, saved) : 1;
    } catch {
      return 1;
    }
  });
  const [space, setSpace] = useState({ width, height: 600 });
  const [height, setHeight] = useState(40);
  const baseWidth = Math.min(width, space.width);
  const maxScale = Math.min(3, space.width / baseWidth, space.height / height);
  const minScale = Math.min(0.6, maxScale);
  const visibleScale = Math.max(minScale, Math.min(maxScale, scale));

  useLayoutEffect(() => {
    const bounds = boundsRef?.current;
    const measure = () =>
      setSpace({
        width: Math.max(1, (bounds?.clientWidth ?? window.innerWidth) - 24),
        height: Math.max(
          1,
          bounds ? bounds.clientHeight - 24 : window.innerHeight * 0.65,
        ),
      });
    measure();
    const observer = new ResizeObserver(measure);
    if (bounds) observer.observe(bounds);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [boundsRef]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(Math.max(1, content.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(scale));
    } catch {
      /* Storage may be disabled. */
    }
  }, [scale, storageKey]);

  const resize = (next: number) =>
    setScale(Math.max(minScale, Math.min(maxScale, next)));
  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      scale: visibleScale,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start) return;
    event.preventDefault();
    const dx = (event.clientX - start.x) * (centered ? 2 : 1);
    const dy = event.clientY - start.y;
    const change =
      (dx * start.width + dy * start.height) /
      (start.width ** 2 + start.height ** 2);
    resize(start.scale * (1 + change));
  };
  const keyboardResize = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    }[event.key];
    if (direction === undefined && event.key !== "Home") return;
    event.preventDefault();
    event.stopPropagation();
    resize(event.key === "Home" ? 1 : visibleScale + direction * 0.1);
  };

  return (
    <div
      ref={boxRef}
      className={cn("relative", className)}
      data-guardian-message={label}
      style={{ width: baseWidth * visibleScale, height: height * visibleScale }}
    >
      <div
        ref={contentRef}
        style={{
          width: baseWidth,
          transform: `scale(${visibleScale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
      <button
        type="button"
        aria-label={`Resize ${label}`}
        title="Drag to resize proportionally. Arrow keys resize; double-click or Home resets."
        className="guardian-resize-handle absolute bottom-0 right-0 z-10 grid h-6 w-6 cursor-nwse-resize touch-none select-none place-items-center rounded-br-md bg-background/30 text-current opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={() => resize(1)}
        onKeyDown={keyboardResize}
      >
        <Grip className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
