import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grabFrame } from "@/lib/frameBus";
import { VIDEO_VIEW_KEY } from "@/lib/videoSizing";
import { VideoStage } from "./VideoStage";

const app = vi.hoisted(() => ({
  videoUrl: "/test-process.mp4", liveStream: null, running: false,
  analysis: { compress: true, visionDetail: "auto", cropRect: [0.2, 0.1, 0.8, 0.9] },
  monitor: { active: false }, guardianLog: [], monitorAlert: null,
  showGuidance: false, patientInfoOn: false, analysisError: null, referenceFilm: null,
  sourceKind: "video", sourceReady: true, sourceId: "test-source", videoFps: 30,
  setAnalysisError: vi.fn(), setShowGuidance: vi.fn(), requestAnalysis: vi.fn(),
  resetTimeline: vi.fn(), toggleRecording: vi.fn(), setAnalysis: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useApp: () => app }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/useGeneralGuidance", () => ({ useGeneralGuidance: () => {} }));
vi.mock("@/lib/useSessionMemory", () => ({ useSessionMemory: () => {} }));
vi.mock("@/lib/voiceBus", () => ({ useVoiceState: () => ({ active: false, supported: false }), voiceToggle: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  app.setAnalysis.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function video() {
  const element = screen.getByLabelText("Process video") as HTMLVideoElement;
  Object.defineProperties(element, {
    videoWidth: { configurable: true, value: 1920 },
    videoHeight: { configurable: true, value: 1080 },
    readyState: { configurable: true, value: 4 },
    duration: { configurable: true, value: 60 },
    currentTime: { configurable: true, writable: true, value: 3 },
    currentSrc: { configurable: true, value: "/test-process.mp4" },
    paused: { configurable: true, value: true },
  });
  fireEvent.loadedMetadata(element);
  return element;
}

function sizeControls() {
  fireEvent.click(screen.getByRole("button", { name: "Video size" }));
  return screen.getByRole("dialog", { name: "Video size controls" });
}

describe("video sizing controls", () => {
  it("opens nonmodally and closes with Escape without changing the video", async () => {
    render(<VideoStage />);
    const source = video();
    const controls = sizeControls();
    expect(controls).not.toHaveAttribute("aria-modal", "true");
    expect(document.body).not.toHaveStyle({ pointerEvents: "none" });
    expect(source.closest("[inert]")).toBeNull();
    fireEvent.keyDown(controls, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Video size controls" })).toBeNull());
    expect(source.currentTime).toBe(3);
    expect(screen.getByLabelText("Process video")).toBe(source);
  });

  it("defaults to fill, offers full frame, accepts wide manual zoom and resets without seeking", () => {
    render(<VideoStage />);
    const source = video();
    expect(source).toHaveStyle({ objectFit: "cover", transform: "scale(1)" });
    sizeControls();
    expect(screen.getByText(/Fill crops edges/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Full frame" }));
    expect(source).toHaveStyle({ objectFit: "contain", transform: "scale(1)" });
    const input = screen.getByRole("spinbutton", { name: "Zoom percent" });
    fireEvent.change(input, { target: { value: "375" } });
    expect(source).toHaveStyle({ transform: "scale(3.75)" });
    fireEvent.loadedMetadata(source);
    expect(source).toHaveStyle({ transform: "scale(3.75)" });
    expect(JSON.parse(localStorage.getItem(VIDEO_VIEW_KEY)!)).toEqual({ fit: "fit", zoom: 3.75 });
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(800);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset video view" }));
    expect(source).toHaveStyle({ objectFit: "cover", transform: "scale(1)" });
    expect(input).toHaveValue(100);
    expect(source.currentTime).toBe(3);
  });

  it("captures the same complete source frame regardless of display fit, zoom or analysis region", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,original-source-frame");
    render(<VideoStage />);
    const source = video();
    const before = grabFrame();
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 640, 360);
    sizeControls();
    fireEvent.click(screen.getByRole("button", { name: "Full frame" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Zoom percent" }), { target: { value: "700" } });
    expect(grabFrame()).toEqual(before);
    expect(before.b64).toBe("original-source-frame");
    expect(app.setAnalysis).not.toHaveBeenCalled();
    expect(app.analysis.cropRect).toEqual([0.2, 0.1, 0.8, 0.9]);
  });

  it("keeps resize and zoom keyboard actions separate from video frame shortcuts", () => {
    render(<VideoStage />);
    const source = video();
    sizeControls();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Video zoom" }), { key: "ArrowRight", code: "ArrowRight" });
    const separator = document.createElement("div");
    separator.setAttribute("role", "separator");
    document.body.append(separator);
    fireEvent.keyDown(separator, { key: "ArrowLeft", code: "ArrowLeft" });
    separator.remove();
    const prevented = new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true });
    prevented.preventDefault();
    document.body.dispatchEvent(prevented);
    expect(source.currentTime).toBe(3);
    fireEvent.keyDown(document.body, { key: "ArrowRight", code: "ArrowRight" });
    expect(source.currentTime).toBeCloseTo(3 + 1 / 30);
  });

  it("passes actual editor height changes and reset to the workspace without changing the source", () => {
    const onHeightChange = vi.fn(), onReset = vi.fn();
    render(<VideoStage editorSizing={{ heightPx: 600, minHeightPx: 240, maxHeightPx: 1000, onHeightChange, onReset }} />);
    const source = video();
    sizeControls();
    const input = screen.getByRole("spinbutton", { name: "Video editor height (px)" });
    fireEvent.change(input, { target: { value: "777" } });
    expect(onHeightChange).toHaveBeenCalledWith(777);
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.blur(input);
    expect(onHeightChange).toHaveBeenCalledWith(1000);
    fireEvent.click(screen.getByRole("button", { name: "Use available height" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(source.currentTime).toBe(3);
  });
});
