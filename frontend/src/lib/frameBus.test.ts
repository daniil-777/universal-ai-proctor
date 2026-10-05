import { afterEach, describe, expect, it } from "vitest";
import {
  bufferFrame,
  clearFrames,
  grabFrame,
  recentFrames,
  recentFrameSamples,
  setVideoAccessor,
} from "./frameBus";
afterEach(() => {
  clearFrames();
  setVideoAccessor(null);
});
describe("bounded frame sampling", () => {
  it("returns an empty paused view when no video exists", () => {
    expect(grabFrame()).toEqual({
      b64: null,
      currentS: 0,
      durationS: 0,
      paused: true,
    });
    expect(recentFrames()).toEqual([]);
  });
  it("captures current source frames without retaining old sources", () => {
    setVideoAccessor(() => ({ b64: "jpeg", currentS: 5, durationS: 10 }));
    expect(grabFrame().currentS).toBe(5);
    bufferFrame(grabFrame());
    clearFrames();
    expect(recentFrames()).toEqual([]);
  });
  it("bounds its buffer and evenly samples only the requested time window", () => {
    for (let i = 0; i < 60; i++)
      bufferFrame({ b64: String(i), currentS: i, durationS: 30 });
    expect(recentFrames(100, 100)).toHaveLength(31);
    expect(recentFrames(4, 3)).toEqual(["55", "57", "59"]);
    expect(recentFrames(4, 1)).toEqual(["59"]);
  });
  it("clears future frames on small backward seeks and retains frame timestamps", () => {
    bufferFrame({ b64: "old", currentS: 4, durationS: 10 });
    bufferFrame({ b64: "rewound", currentS: 3.6, durationS: 10 });
    expect(recentFrameSamples()).toEqual([{ b64: "rewound", currentS: 3.6 }]);
  });
  it("bounds invalid sample counts", () => {
    for (let i = 0; i < 10; i++)
      bufferFrame({ b64: String(i), currentS: i, durationS: 10 });
    expect(recentFrames(5, 0)).toEqual(["9"]);
  });
  it("does not repeatedly store paused frames", () => {
    for (let i = 0; i < 100; i++)
      bufferFrame({ b64: "same", currentS: 1, durationS: 10 });
    expect(recentFrames(10, 100)).toEqual(["same"]);
  });
});
it("deduplicates exact images using their latest timestamps and preserves tiny changes", () => {
  bufferFrame({ b64: "same", currentS: 1, durationS: 10 });
  bufferFrame({ b64: "same!", currentS: 2, durationS: 10 });
  bufferFrame({ b64: "same", currentS: 3, durationS: 10 });
  expect(recentFrameSamples(5, 4)).toEqual([{ b64: "same!", currentS: 2 }, { b64: "same", currentS: 3 }]);
});
it("retains older context and three current motion views without adding images", () => {
  for (const time of [0, 1, 2, 3, 4, 4.25, 4.5, 4.75, 5])
    bufferFrame({ b64: `frame-${time}`, currentS: time, durationS: 10 });
  expect(recentFrameSamples(5, 4).map(f => f.currentS)).toEqual([0, 3, 4.25, 5]);
  expect(recentFrameSamples(5, 4, true).map(f => f.currentS)).toEqual([0, 4, 4.5, 5]);
  expect(recentFrameSamples(5, 2, true).map(f => f.currentS)).toEqual([0, 5]);
});
it("falls back to even sampling when recent motion views are sparse", () => {
  for (const time of [0, 1, 2, 3, 4, 5])
    bufferFrame({ b64: `frame-${time}`, currentS: time, durationS: 10 });
  expect(recentFrameSamples(5, 4, true)).toEqual(recentFrameSamples(5, 4));
});
it("uses the full larger image budget while preserving recent motion and older context", () => {
  for (let tick = 0; tick < 32; tick++)
    bufferFrame({ b64: `view-${tick}`, currentS: tick / 4, durationS: 10 });
  const selected = recentFrameSamples(8, 9, true);
  expect(selected).toHaveLength(9);
  expect(selected.slice(-3).map(f => f.currentS)).toEqual([6.75, 7.25, 7.75]);
  expect(selected[0]?.currentS).toBe(0);
  expect(selected.map(f => f.currentS)).toEqual(selected.map(f => f.currentS).sort((a, b) => a - b));
  expect(new Set(selected.map(f => f.b64)).size).toBe(9);
});
it("keeps recent motion samples distinct, ordered and inside the requested window", () => {
  for (const [time, b64] of [[0, "excluded"], [2, "context"], [4, "repeat"], [4.25, "change"], [4.5, "repeat"], [4.75, "other"], [5, "latest"]] as const)
    bufferFrame({ b64, currentS: time, durationS: 10 });
  const selected = recentFrameSamples(3, 4, true);
  expect(selected.map(f => f.currentS)).toEqual([2, 4.25, 4.75, 5]);
  expect(new Set(selected.map(f => f.b64)).size).toBe(selected.length);
});
it("retains a delayed check's older context without sacrificing dense recent motion", () => {
  for (let tick = 0; tick < 120; tick++)
    bufferFrame({ b64: `view-${tick}`, currentS: tick / 4, durationS: 0 });
  const selected = recentFrameSamples(30, 9, true);
  expect(selected).toHaveLength(9);
  expect(selected[0]?.currentS).toBe(0);
  expect(selected.slice(-3).map(f => f.currentS)).toEqual([28.75, 29.25, 29.75]);
  expect(recentFrameSamples(30, 32).length).toBeLessThanOrEqual(32);
  bufferFrame({ b64: "later", currentS: 35, durationS: 0 });
  expect(recentFrameSamples(100, 32).every(f => f.currentS >= 5)).toBe(true);
});
it("bounds retained image data even for large camera JPEGs", () => {
  const large = "x".repeat(2 * 1024 * 1024);
  for (let i = 0; i < 8; i++)
    bufferFrame({ b64: `${i}${large}`, currentS: i, durationS: 0 });
  expect(recentFrameSamples(30, 32)).toHaveLength(3);
  bufferFrame({ b64: "oversized" + "x".repeat(8 * 1024 * 1024), currentS: 8, durationS: 0 });
  expect(recentFrameSamples(30, 32)).toHaveLength(3);
});
it("collapses consecutive unchanged images and ignores invalid timestamps", () => {
  for (let i = 0; i < 80; i++)
    bufferFrame({ b64: "held", currentS: i / 4, durationS: 0 });
  bufferFrame({ b64: "invalid", currentS: NaN, durationS: 0 });
  expect(recentFrameSamples(30, 9)).toEqual([{ b64: "held", currentS: 19.75 }]);
});
