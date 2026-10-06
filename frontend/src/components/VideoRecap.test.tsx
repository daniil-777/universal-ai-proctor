import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recapFixture } from "@/lib/videoSummaryTestFixture";
import type { VideoRecapState } from "@/lib/useVideoRecap";
import { VideoRecapDialog } from "./VideoRecap";

const mocks = vi.hoisted(() => ({ app: {} as Record<string, unknown> }));
vi.mock("@/lib/store", () => ({ useApp: () => mocks.app }));
vi.mock("@/lib/speech", () => ({ getSpeechPhase: () => "idle", subscribeSpeech: () => () => {} }));
vi.mock("./ReportLauncher", () => ({ ReportLauncher: ({ children }: { children: React.ReactNode }) => children }));
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

function state(): VideoRecapState {
  return { job: recapFixture(), plan: null, open: true, setOpen: vi.fn(), openRecap: vi.fn(), mode: "detailed", setMode: vi.fn(), domainOverride: "auto", setDomainOverride: vi.fn(), includeAudio: false, setIncludeAudio: vi.fn(), narrationEnabled: false, setNarrationEnabled: vi.fn(), narratingWindow: null, awaitingSummary: false, planLoading: false, actionBusy: null, error: "", eligible: true, active: false, ownsUploadedAnalysis: true, guidanceResumed: false, resumeGuidance: vi.fn(), refresh: vi.fn(), loadPlan: vi.fn(), start: vi.fn(), cancel: vi.fn(), retry: vi.fn(), download: vi.fn(), notifyPlayback: vi.fn() };
}
beforeEach(() => {
  mocks.app = { sourceId: "source-A", sourceName: "Synthetic test video.mp4", useMock: false, model: { display: "Next selected model" }, recap: state() };
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll); else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("evidence-backed video recap", () => {
  it("leads with domain metrics and keeps measured, estimated and unavailable facts distinct", () => {
    const recap = mocks.app.recap as VideoRecapState;
    const job = recap.job!;
    job.metric_plan = [{ id: "assembly", label: "Assembly episodes", question: "Which cited episodes show assembly?", kind: "count", unit: "episodes", method: "Count supported episodes.", limitations: "Sampling is not exhaustive." }];
    job.metrics = [
      { id: "duration", label: "Source duration", value: 6, unit: "seconds", status: "measured", method: "Native media metadata.", evidence_refs: [], explanation: "A technical measurement." },
      { id: "assembly", label: "Assembly episodes", value: 1, unit: "episodes", status: "estimated", method: "Supported retained events.", evidence_refs: ["W0001-E01"], explanation: "A lower bound from sampled evidence." },
      { id: "hidden-defects", label: "Internal defects", value: null, unit: "defects", status: "unavailable", method: "No calibrated internal inspection.", evidence_refs: [], explanation: "Not established by this video." },
    ];
    render(<VideoRecapDialog />);
    const metrics = within(screen.getByRole("region", { name: "Domain metrics" })).getAllByRole("article");
    expect(within(metrics[0]).getByRole("heading").textContent).toBe("Assembly episodes");
    expect(within(metrics[0]).getByText("estimated")).toBeVisible();
    expect(within(metrics[1]).getByText("measured")).toBeVisible();
    expect(within(metrics[2]).getByText("Unavailable", { exact: true })).toBeVisible();
    expect(screen.queryByText(/70%|confidence score|quality score/i)).toBeNull();
    expect(screen.getByText(/Analysis model: test-model/)).toBeVisible();
  });

  it("opens the actual finding and supporting frame, then seeks only the owned source", () => {
    const recap = mocks.app.recap as VideoRecapState;
    render(<VideoRecapDialog />);
    fireEvent.click(screen.getAllByRole("button", { name: "View evidence W0001-E01" })[0]);
    const detail = screen.getByTestId("video-recap-evidence");
    expect(detail).toHaveFocus();
    expect(within(detail).getByText("Test event supported by its sampled frame.")).toBeVisible();
    fireEvent.click(within(detail).getByRole("button", { name: "View evidence W0001-F01" }));
    expect(within(detail).getByText(/Source frame at 2.000 seconds/)).toBeVisible();
    const seeks = vi.fn(); window.addEventListener("guidance-review-seek", seeks);
    fireEvent.click(within(detail).getByRole("button", { name: "Review this moment in video" }));
    expect(seeks.mock.calls[0][0].detail).toEqual({ sourceId: "source-A", timeS: 2 });
    expect(recap.setOpen).toHaveBeenCalledWith(false);
    window.removeEventListener("guidance-review-seek", seeks);
  });

  it("preserves partial failures and offers retry without claiming full coverage", () => {
    const recap = mocks.app.recap as VideoRecapState;
    recap.job = recapFixture({ status: "partial", progress: { total_windows: 2, completed_windows: 1, failed_windows: 1, analyzed_through_s: 6, sampled_frames: 1 }, error: "One interval could not be analyzed." });
    render(<VideoRecapDialog />);
    expect(screen.getByText("Partial result", { exact: true })).toBeVisible();
    expect(screen.getByText(/Sampled windows do not establish continuous/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry failed windows" }));
    expect(recap.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Download recap JSON" }));
    expect(recap.download).toHaveBeenCalledOnce();
  });
  it("preserves a legitimate snapshot in Demo mode while disabling narration and paid Start", () => {
    const recap = mocks.app.recap as VideoRecapState; recap.eligible = false; mocks.app.useMock = true;
    render(<VideoRecapDialog />);
    expect(screen.getByRole("checkbox", { name: "Narrate during playback" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start video recap" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "A synthetic test recap" })).toBeVisible();
  });
  it("offers an explicit Resume guidance handoff only after analysis stops", () => {
    const recap = mocks.app.recap as VideoRecapState;
    const view = render(<VideoRecapDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Resume guidance" }));
    expect(recap.resumeGuidance).toHaveBeenCalledOnce();
    recap.job = recapFixture({ status: "analyzing", summary: null }); recap.active = true;
    view.rerender(<VideoRecapDialog />);
    expect(screen.queryByRole("button", { name: "Resume guidance" })).toBeNull();
  });
});
