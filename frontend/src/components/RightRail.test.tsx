import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightRail, type GuidanceSizingControls } from "./RightRail";

vi.mock("@/lib/store", () => ({ useApp: () => ({ mode: "user" }) }));
vi.mock("./right-rail/StagesTab", () => ({ StagesTab: () => <p>Original guidance instructions</p> }));
afterEach(cleanup);

function showSizing() {
  const sizing: GuidanceSizingControls = {
    widthPx: 380, heightPx: 520, textSizePx: 14,
    minWidthPx: 220, maxWidthPx: 960, minHeightPx: 180, maxHeightPx: 680,
    onWidthChange: vi.fn(), onHeightChange: vi.fn(), onTextSizeChange: vi.fn(), onReset: vi.fn(),
  };
  render(<RightRail sizing={sizing} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust guidance size" }));
  return sizing;
}

describe("guidance sizing controls", () => {
  it("accepts a continuous custom text size and commits exact numeric input", () => {
    const sizing = showSizing();
    const input = screen.getByRole("spinbutton", { name: "Guidance text size (px)" });
    input.focus();
    fireEvent.change(input, { target: { value: "30" } });
    expect(sizing.onTextSizeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sizing.onTextSizeChange).toHaveBeenLastCalledWith(30);
    fireEvent.change(screen.getByRole("slider", { name: "Guidance text size slider" }), { target: { value: "24" } });
    expect(sizing.onTextSizeChange).toHaveBeenLastCalledWith(24);
  });

  it("cancels numeric editing with Escape without committing a stale draft", () => {
    const sizing = showSizing();
    const input = screen.getByRole("spinbutton", { name: "Guidance text size (px)" });
    input.focus();
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue(14);
    expect(sizing.onTextSizeChange).not.toHaveBeenCalled();
  });
});
