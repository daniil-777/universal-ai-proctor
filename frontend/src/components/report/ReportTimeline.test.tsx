import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewEvent, ReviewResponse } from "@/lib/reviewTypes";
import { ReportTimeline } from "./ReportTimeline";

const event = (id: string, time: number, patch: Partial<ReviewEvent> = {}): ReviewEvent => ({
  id, source_id: "video-A", reference_key: "guide", kind: "observation", provenance: "ai",
  occurred_at: 1000, video_time_s: time, summary: id, concern: "", guidance: "",
  status: "ok", step_ids: [], old_reference: false, ...patch,
});
const review = (events: ReviewEvent[], source = "video-A") =>
  ({ source_id: source, events }) as ReviewResponse;

describe("recorded timeline", () => {
  it("provides keyboard-size controls, exact replay ownership and no automatic requests", () => {
    const replay = vi.fn();
    render(<ReportTimeline review={review([event("Later concern", 12, { status: "watch" }), event("First frame", 0)])} onReplay={replay} />);
    expect(screen.getByLabelText("Choose recorded moment")).toHaveValue("First frame");
    expect(screen.getByRole("button", { name: "Previous recorded moment" })).toBeDisabled();
    expect(replay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next recorded moment" }));
    expect(screen.getByLabelText("Choose recorded moment")).toHaveValue("Later concern");
    expect(screen.getByRole("button", { name: "Next recorded moment" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review in video" }));
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ id: "Later concern", source_id: "video-A", video_time_s: 12 }));
  });
  it("discards selection when a different source replaces the video and handles a zero-time sample", () => {
    const rendered = render(<ReportTimeline review={review([event("A", 0), event("B", 1)])} />);
    fireEvent.change(screen.getByLabelText("Choose recorded moment"), { target: { value: "B" } });
    rendered.rerender(<ReportTimeline review={review([event("new", 0, { source_id: "video-B" })], "video-B")} />);
    expect(screen.getByLabelText("Choose recorded moment")).toHaveValue("new");
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("00:00"));
    expect(screen.queryByRole("button", { name: "Review in video" })).toBeNull();
  });
  it("does not portray simulated or whole-video overview records as real observed moments", () => {
    render(<ReportTimeline review={review([event("demo", 12, { simulated: true }), event("overview", 3, { observation_scope: "overview" })])} />);
    expect(screen.queryByLabelText("Choose recorded moment")).toBeNull();
    expect(screen.getByText(/No real moments retained yet/)).toBeVisible();
  });
  it("shows a whole-source axis including the empty tail and links the selected snapshot reference without replay", () => {
    const evidence = vi.fn();
    render(<ReportTimeline review={{ ...review([event("last", 12)]), source_duration_s: 120 }} onEvidence={evidence} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("known source duration 00:00 to 02:00"));
    expect(screen.getByText("02:00 · source duration")).toBeVisible();
    expect(screen.getByText(/Gaps have no retained record/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View evidence E01" }));
    expect(evidence).toHaveBeenCalledWith("last");
  });
  it("keeps known-duration empty timelines visible without manufacturing a selected record", () => {
    render(<ReportTimeline review={{ ...review([]), source_duration_s: 90 }} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("0 retained moments"));
    expect(screen.getByText("01:30 · source duration")).toBeVisible();
    expect(screen.queryByLabelText("Choose recorded moment")).toBeNull();
  });
  it("places a retained moment at the actual end of a subsecond source instead of treating duration as one second", () => {
    const { container } = render(<ReportTimeline review={{ ...review([event("end", .5)]), source_duration_s: .5 }} />);
    expect(container.querySelector<HTMLElement>(".report-time-cursor")!.style.left).toBe("100%");
    expect(container.querySelectorAll(".report-time-bin")[39]).not.toHaveClass("empty");
    expect(container.querySelectorAll(".report-time-bin")[20]).toHaveClass("empty");
  });
});
