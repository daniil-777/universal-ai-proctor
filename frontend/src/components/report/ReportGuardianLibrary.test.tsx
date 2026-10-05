import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewEvent, ReviewResponse } from "@/lib/reviewTypes";
import { ReportGuardianLibrary } from "./ReportGuardianLibrary";

const harness = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn(), share: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: harness.fetch }));
vi.mock("@/lib/reportShare", () => ({ downloadReport: harness.download, shareReport: harness.share }));
function review(events: Partial<ReviewEvent>[] = [{ id: "watch-1", status: "watch" }, { id: "alert-1", status: "alert" }]): ReviewResponse {
  return { ok: true, source_id: "source-A", reference_key: "a".repeat(64), review_version: 2, job: { work_order: "", asset: "", operator: "" }, checks: [], exceptions: [], notice: "Recorded samples", retention: { events: 150, thumbnails: 24, retained_events: events.length, retained_thumbnails: 0, dropped_events: 0, dropped_thumbnails: 0, dropped_exceptions: 0 }, events: events.map((event, index) => ({ id: `event-${index}`, source_id: "source-A", reference_key: "a".repeat(64), kind: "observation", provenance: "ai", occurred_at: 1000, video_time_s: 8 + index, summary: `Finding ${index}`, concern: "Needs operator review", guidance: "", status: "watch", step_ids: [], old_reference: false, ...event })) };
}
const response = () => new Response(new Blob(["fixture video"], { type: "video/mp4" }), { headers: { "Content-Type": "video/mp4" } });
beforeEach(() => {
  for (const mock of Object.values(harness)) mock.mockReset();
  harness.create.mockReturnValue("blob:guardian-preview");
  const original = URL;
  vi.stubGlobal("URL", new Proxy(original, { get(target, key) { if (key === "createObjectURL") return harness.create; if (key === "revokeObjectURL") return harness.revoke; return Reflect.get(target, key, target); } }));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Guardian chunk library", () => {
  it("includes watches and alerts but separates demos, overview samples, bookmarks and other sources", () => {
    const data = review([{ id: "watch", status: "watch" }, { id: "alert", status: "alert" }, { id: "demo", simulated: true }, { id: "overview", observation_scope: "overview" }, { id: "bookmark", kind: "bookmark", provenance: "operator" }, { id: "old-source", source_id: "old" }, { id: "okay", status: "ok" }]);
    render(<ReportGuardianLibrary apiBase="" review={data} videoAvailable />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Finding 0")).toBeInTheDocument();
    expect(screen.getByText("Finding 1")).toBeInTheDocument();
    expect(screen.queryByText("Finding 2")).toBeNull();
    expect(harness.fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Guardian finding type"), { target: { value: "alert" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Finding 1")).toBeInTheDocument();
  });

  it("prepares a source/reference-bound clip on request and releases media on close", async () => {
    harness.fetch.mockImplementation(async () => response());
    const rendered = render(<ReportGuardianLibrary apiBase="" review={review()} videoAvailable />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare clip at 00:08" }));
    const preview = await screen.findByRole("region", { name: "Guardian clip preview" });
    const video = preview.querySelector("video")!;
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("autoplay");
    const request = new URL(harness.fetch.mock.calls[0][0], "http://localhost");
    expect(request.pathname).toBe("/api/review/incidents/watch-1/clip");
    expect(request.searchParams.get("source_id")).toBe("source-A");
    expect(request.searchParams.get("reference_key")).toBe("a".repeat(64));
    fireEvent.click(screen.getByRole("button", { name: "Download clip" }));
    expect(harness.download.mock.calls[0][0].name).toBe("guardian-watch-00m08s.mp4");
    rendered.unmount();
    expect(video.pause).toHaveBeenCalled();
    expect(video.load).toHaveBeenCalled();
    expect(video).not.toHaveAttribute("src");
    expect(harness.revoke).toHaveBeenCalledWith("blob:guardian-preview");
  });

  it("cancels a delayed clip when the source changes and never creates its preview", async () => {
    let resolve!: (value: Response) => void;
    harness.fetch.mockReturnValue(new Promise<Response>(result => { resolve = result; }));
    const data = review();
    const rendered = render(<ReportGuardianLibrary apiBase="" review={data} videoAvailable />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare clip at 00:08" }));
    const signal = harness.fetch.mock.calls[0][1].signal as AbortSignal;
    rendered.rerender(<ReportGuardianLibrary apiBase="" review={{ ...data, source_id: "source-B", events: [] }} videoAvailable />);
    await act(async () => resolve(response()));
    expect(signal.aborted).toBe(true);
    expect(harness.create).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Guardian clip preview" })).toBeNull();
  });

  it("keeps findings visible without inventing video chunks for a live camera", () => {
    render(<ReportGuardianLibrary apiBase="" review={review()} videoAvailable={false} />);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Prepare clip at 00:08" })).toBeDisabled();
    expect(screen.getByText(/live footage is not recorded by Guardian/)).toBeInTheDocument();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("keeps the finding available after a source-guard failure", async () => {
    harness.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Input changed. Refresh the report." }), { status: 409 }));
    render(<ReportGuardianLibrary apiBase="" review={review()} videoAvailable />);
    fireEvent.click(screen.getByRole("button", { name: "Prepare clip at 00:08" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Input changed");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Prepare clip at 00:08" })).toBeEnabled();
  });
});
