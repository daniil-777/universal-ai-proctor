import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampVideoZoom, DEFAULT_VIDEO_VIEW, readVideoView, saveVideoView, VIDEO_VIEW_KEY, videoViewStyle } from "./videoSizing";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("video view preferences", () => {
  it("starts with an aspect-preserving fill view and permits uncropped full-frame viewing", () => {
    expect(readVideoView()).toEqual(DEFAULT_VIDEO_VIEW);
    expect(videoViewStyle(DEFAULT_VIDEO_VIEW).objectFit).toBe("cover");
    expect(videoViewStyle({ fit: "fit", zoom: 1 }).objectFit).toBe("contain");
  });

  it("restores valid choices while bounding old or malformed zoom values", () => {
    saveVideoView({ fit: "fit", zoom: 3.75 });
    expect(readVideoView()).toEqual({ fit: "fit", zoom: 3.75 });
    localStorage.setItem(VIDEO_VIEW_KEY, JSON.stringify({ fit: "fill", zoom: 99 }));
    expect(readVideoView()).toEqual({ fit: "fill", zoom: 8 });
    localStorage.setItem(VIDEO_VIEW_KEY, JSON.stringify({ fit: "stretch", zoom: 1 }));
    expect(readVideoView()).toEqual(DEFAULT_VIDEO_VIEW);
    localStorage.setItem(VIDEO_VIEW_KEY, "broken JSON");
    expect(readVideoView()).toEqual(DEFAULT_VIDEO_VIEW);
    expect([clampVideoZoom(-1), clampVideoZoom(NaN), clampVideoZoom(2.375)]).toEqual([0.25, 1, 2.375]);
  });

  it("keeps view controls usable when preference storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(readVideoView()).toEqual(DEFAULT_VIDEO_VIEW);
    expect(() => saveVideoView({ fit: "fit", zoom: 2 })).not.toThrow();
  });
});
