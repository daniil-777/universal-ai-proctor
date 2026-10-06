import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeicaWorkspaceReference } from "./LeicaWorkspaceReference";
import { LEICA_STUDY_INTRO } from "@/lib/leicaStudy";

const harness = vi.hoisted(() => ({
  app: {} as Record<string, unknown>,
  speak: vi.fn(),
  interruptAnswers: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useApp: () => harness.app }));
vi.mock("@/lib/speech", () => ({ speak: harness.speak, interruptAnswers: harness.interruptAnswers }));

beforeEach(() => {
  harness.app = {
    referenceFilm: "leica-m10",
    apiBase: "/ai",
    liveStream: null,
    sourceKind: null,
    startLiveVideo: vi.fn().mockResolvedValue(true),
    resetSource: vi.fn().mockResolvedValue("source-film"),
    setVideoUrl: vi.fn(),
    setRunning: vi.fn(),
    setMonitor: vi.fn(),
    stopLiveVideo: vi.fn(),
  };
  harness.speak.mockReset();
  harness.interruptAnswers.mockReset();
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: vi.fn() } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Leica guided workspace", () => {
  it("distinguishes an applied guide from a captured view and never starts capture or analysis on mount", () => {
    render(<LeicaWorkspaceReference />);
    expect(screen.getByRole("status")).toHaveTextContent("Guide loaded · film not shared");
    expect(harness.app.startLiveVideo).not.toHaveBeenCalled();
    expect(harness.app.resetSource).not.toHaveBeenCalled();
    expect(harness.app.setRunning).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("link", { name: /Open YouTube film/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=p4t-OVIvuy8");
  });

  it("opens the real screen picker only on request and registers its selected view without inferring progress", async () => {
    const { rerender } = render(<LeicaWorkspaceReference />);
    fireEvent.click(screen.getByRole("button", { name: "Share authorized footage" }));
    await waitFor(() => expect(harness.app.resetSource).toHaveBeenCalledWith("screen", "Shared view — Leica M10 assembly study"));
    expect(harness.app.startLiveVideo).toHaveBeenCalledWith("screen");
    expect(harness.app.setRunning).toHaveBeenCalledWith(false);
    expect(harness.app.setMonitor).toHaveBeenCalledWith({ active: false });
    harness.app.liveStream = { getVideoTracks: () => [{ label: "Leica Camera on YouTube" }] };
    harness.app.sourceKind = "screen";
    rerender(<LeicaWorkspaceReference />);
    expect(screen.getByRole("status")).toHaveTextContent("Shared input connected");
    expect(screen.getByText("Selected view: Leica Camera on YouTube")).toBeVisible();
    expect(screen.getByText(/Select Analyze current view/)).toBeVisible();
  });

  it("leaves the guide watchable when the user cancels screen sharing", async () => {
    vi.mocked(harness.app.startLiveVideo as () => Promise<boolean>).mockResolvedValue(false);
    render(<LeicaWorkspaceReference />);
    fireEvent.click(screen.getByRole("button", { name: "Share authorized footage" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Share authorized footage" })).toBeEnabled());
    expect(harness.app.resetSource).not.toHaveBeenCalled();
    expect(harness.app.setRunning).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("film not shared");
  });

  it("explains unsupported tab sharing while preserving the official source and guide", () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    render(<LeicaWorkspaceReference />);
    expect(screen.getByRole("button", { name: "Share authorized footage" })).toBeDisabled();
    expect(screen.getByText(/Tab sharing is unavailable/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Open YouTube film/ })).toBeVisible();
  });

  it("uses the existing real TTS channel to read study instructions without inventing observations", () => {
    render(<LeicaWorkspaceReference />);
    fireEvent.click(screen.getByRole("button", { name: "Hear study instructions" }));
    expect(harness.interruptAnswers).toHaveBeenCalledOnce();
    expect(harness.speak).toHaveBeenCalledWith("/ai", LEICA_STUDY_INTRO);
    expect(harness.app.startLiveVideo).not.toHaveBeenCalled();
  });

  it("loads the separate official player only on Play and removes it when the study closes", () => {
    const { rerender } = render(<LeicaWorkspaceReference />);
    const details = screen.getByText("Watch the official film here").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play official film in workspace" }));
    const iframe = screen.getByTitle("Official Leica Camera film in the study workspace");
    expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(iframe.parentElement?.querySelector("button")).toBeNull();
    harness.app.referenceFilm = null;
    rerender(<LeicaWorkspaceReference />);
    expect(document.querySelector("iframe")).toBeNull();
    harness.app.referenceFilm = "leica-m10";
    rerender(<LeicaWorkspaceReference />);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
