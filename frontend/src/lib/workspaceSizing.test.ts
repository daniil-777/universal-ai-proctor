import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_SIZING, parseWorkspaceSizing, workspaceSizingBounds } from "./workspaceSizing";

describe("saved workspace sizing", () => {
  it("keeps continuous custom sizes and independent editor height", () => {
    expect(parseWorkspaceSizing(JSON.stringify({ guidanceWidthPx: 713, guidanceHeightPx: 327, editorHeightPx: 591, textSizePx: 30 })))
      .toEqual({ guidanceWidthPx: 713, guidanceHeightPx: 327, editorHeightPx: 591, textSizePx: 30 });
  });
  it("recovers from malformed storage and rejects invalid individual values", () => {
    expect(parseWorkspaceSizing("invalid JSON")).toEqual(DEFAULT_WORKSPACE_SIZING);
    expect(parseWorkspaceSizing(JSON.stringify({ guidanceWidthPx: "wide", guidanceHeightPx: -20, textSizePx: 999 })))
      .toEqual({ guidanceWidthPx: 380, guidanceHeightPx: 0, editorHeightPx: 0, textSizePx: 48 });
  });
});

describe("viewport bounds", () => {
  it("lets guidance use most of a wide editor while retaining readable video space", () => {
    expect(workspaceSizingBounds(1200, 700, false)).toMatchObject({ minWidth: 220, maxWidth: 960, minVideoWidth: 240 });
  });
  it("adapts stacked and short layouts without making impossible minimums", () => {
    const bounds = workspaceSizingBounds(320, 300, true);
    expect(bounds.maxWidth).toBe(320);
    expect(bounds.minHeight + bounds.minVideoHeight).toBeLessThanOrEqual(300);
    expect(bounds.maxHeight).toBe(180);
  });
});
