import type { CSSProperties } from "react";

export type VideoView = { fit: "fill" | "fit"; zoom: number };
export type VideoEditorSizing = {
  heightPx: number;
  minHeightPx: number;
  maxHeightPx: number;
  onHeightChange: (height: number) => void;
  onReset: () => void;
};

export const VIDEO_VIEW_KEY = "cueveris-video-view-v1";
export const MIN_VIDEO_ZOOM = 0.25;
export const MAX_VIDEO_ZOOM = 8;
export const DEFAULT_VIDEO_VIEW: VideoView = { fit: "fill", zoom: 1 };

export function clampVideoZoom(value: number): number {
  return Number.isFinite(value)
    ? Math.max(MIN_VIDEO_ZOOM, Math.min(MAX_VIDEO_ZOOM, value))
    : 1;
}

export function readVideoView(): VideoView {
  try {
    const value = JSON.parse(localStorage.getItem(VIDEO_VIEW_KEY) || "null");
    if (value && (value.fit === "fill" || value.fit === "fit") && typeof value.zoom === "number" && Number.isFinite(value.zoom))
      return { fit: value.fit, zoom: clampVideoZoom(value.zoom) };
  } catch { /* View controls also work when storage is unavailable. */ }
  return { ...DEFAULT_VIDEO_VIEW };
}

export function saveVideoView(view: VideoView): void {
  try { localStorage.setItem(VIDEO_VIEW_KEY, JSON.stringify(view)); }
  catch { /* Keep the current view usable without persistent storage. */ }
}

// CSS only changes presentation. Canvas sampling continues to use the original
// videoWidth/videoHeight, so analysis regions remain in source coordinates.
export function videoViewStyle(view: VideoView): CSSProperties {
  return {
    objectFit: view.fit === "fill" ? "cover" : "contain",
    transform: `scale(${clampVideoZoom(view.zoom)})`,
    transformOrigin: "center",
  };
}
