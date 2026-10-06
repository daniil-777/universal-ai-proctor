import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewResponse } from "@/lib/reviewTypes";
import type { Stage } from "@/lib/types";
import { ReportEvidence } from "./ReportEvidence";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch: fetch }));
const image = "data:image/jpeg;base64,AQ==";
function review(count = 1): ReviewResponse {
  return {
    ok: true,
    source_id: "source-A",
    reference_key: "digest-A",
    review_version: 3,
    job: { work_order: "", asset: "", operator: "" },
    checks: [],
    exceptions: [],
    notice: "Recorded samples only.",
    retention: {
      events: 150,
      thumbnails: 24,
      retained_events: count,
      retained_thumbnails: 1,
      dropped_events: 2,
      dropped_thumbnails: 0,
      dropped_exceptions: 0,
    },
    events: Array.from({ length: count }, (_, index) => ({
      id: `event-${index}`,
      source_id: "source-A",
      reference_key: "digest-A",
      kind: index % 2 ? "observation" : "bookmark",
      provenance: "operator",
      occurred_at: 1000 + index,
      video_time_s: index,
      summary: `Moment ${index}`,
      guidance: "",
      concern: "",
      status: "ok",
      step_ids: [],
      old_reference: false,
      thumbnail_available: index === 0,
    })),
  };
}
const response = (data: ReviewResponse) =>
  new Response(JSON.stringify(data), { status: 200 });
beforeEach(() => {
  fetch.mockReset();
});

describe("report evidence ownership and bounded reads", () => {
  it("loads photos only on request and retains explicit capture/provenance captions", async () => {
    const data = review();
    fetch.mockResolvedValue(
      response({
        ...data,
        events: [{ ...data.events[0], thumbnail_b64: image }],
      }),
    );
    render(<ReportEvidence apiBase="" review={data} />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    expect(
      await screen.findByRole("img", { name: /Captured evidence at 00:00/ }),
    ).toHaveAttribute("src", image);
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText("Operator record")).toBeInTheDocument();
    expect(screen.getByText("Captured frame · 00:00")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load evidence photos" }),
    ).toBeNull();
  });

  it("rejects photos from a different source or guidance reference", async () => {
    const data = review();
    fetch.mockResolvedValue(
      response({
        ...data,
        reference_key: "other-guidance",
        events: [{ ...data.events[0], thumbnail_b64: image }],
      }),
    );
    render(<ReportEvidence apiBase="" review={data} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "source or instructions changed",
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Moment 0")).toBeInTheDocument();
  });

  it("stops displaying a cached photo when retention no longer includes it", async () => {
    const data = review();
    fetch.mockResolvedValue(
      response({
        ...data,
        events: [{ ...data.events[0], thumbnail_b64: image }],
      }),
    );
    const rendered = render(<ReportEvidence apiBase="" review={data} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    await screen.findByRole("img");
    rendered.rerender(
      <ReportEvidence
        apiBase=""
        review={{
          ...data,
          review_version: 4,
          events: [{ ...data.events[0], thumbnail_available: false }],
        }}
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Moment 0")).toBeInTheDocument();
  });

  it("discards a delayed photo response after source replacement", async () => {
    const data = review();
    let resolve!: (response: Response) => void;
    fetch.mockReturnValue(
      new Promise<Response>((value) => {
        resolve = value;
      }),
    );
    const rendered = render(<ReportEvidence apiBase="" review={data} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    rendered.rerender(
      <ReportEvidence
        apiBase=""
        review={{ ...data, source_id: "source-B", events: [] }}
      />,
    );
    await act(async () =>
      resolve(
        response({
          ...data,
          events: [{ ...data.events[0], thumbnail_b64: image }],
        }),
      ),
    );
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Moment 0")).toBeNull();
  });

  it("bounds initial cards, reveals retained records and resets the limit for filtering", () => {
    const data = review(30);
    render(<ReportEvidence apiBase="" review={data} />);
    expect(screen.getAllByRole("article")).toHaveLength(12);
    fireEvent.click(
      screen.getByRole("button", { name: "Show more evidence (18 remaining)" }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(24);
    fireEvent.change(screen.getByLabelText("Evidence type"), {
      target: { value: "bookmark" },
    });
    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.queryByText("Moment 29")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show more evidence (3 remaining)" }),
    );
    expect(screen.getAllByRole("article")).toHaveLength(15);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not request external image URLs and leaves text available after photo failure", async () => {
    const data = review();
    data.events[0].thumbnail_b64 = "https://example.com/tracking.png";
    fetch.mockRejectedValue(new Error("Network unavailable"));
    render(<ReportEvidence apiBase="" review={data} />);
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Network unavailable",
      ),
    );
    expect(screen.getByText("Moment 0")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Load evidence photos" }),
    ).toBeEnabled();
  });

  it("aborts its explicit photo read on unmount", () => {
    fetch.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          ),
        ),
    );
    const rendered = render(<ReportEvidence apiBase="" review={review()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load evidence photos" }),
    );
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    rendered.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("retains snapshot references through filtering and reveals an older paginated target on explicit navigation", async () => {
    const data = review(30);
    const rendered = render(<ReportEvidence apiBase="" review={data} />);
    fireEvent.change(screen.getByLabelText("Evidence type"), { target: { value: "observation" } });
    expect(screen.queryByRole("article", { name: "E01 · Moment 0" })).toBeNull();
    rendered.rerender(<ReportEvidence apiBase="" review={data} requestedEvent={{ id: "event-0", sourceId: "source-A", request: 1 }} />);
    const target = await screen.findByRole("article", { name: "E01 · Moment 0" });
    await waitFor(() => expect(target).toHaveFocus());
    expect(screen.getByLabelText("Evidence type")).toHaveValue("all");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never links earlier instructions to current steps even when their identifiers match", () => {
    const data = review(2);
    data.events[0] = { ...data.events[0], step_ids: ["step"], reference_key: "old-digest", old_reference: false };
    data.events[1] = { ...data.events[1], step_ids: ["step"] };
    const onStep = vi.fn();
    render(<ReportEvidence apiBase="" review={data} stages={[{ id: "step", name: "Current step" }] as Stage[]} onStep={onStep} />);
    expect(screen.getByText("Step links belong to earlier instructions.")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "View workflow step Current step" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "View workflow step Current step" }));
    expect(onStep).toHaveBeenCalledWith("step");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps anomalous records readable with explicit timeline exclusions and does not invent an unknown duration", () => {
    const data = review(2);
    data.events[0].video_time_s = -1;
    data.events[1].video_time_s = 90;
    data.source_duration_s = 60;
    const rendered = render(<ReportEvidence apiBase="" review={data} />);
    expect(screen.getByRole("article", { name: "E01 · Moment 0" })).toHaveTextContent("Excluded from timeline: no valid source timestamp.");
    expect(screen.getByRole("article", { name: "E02 · Moment 1" })).toHaveTextContent("Excluded from timeline: timestamp is outside the known source duration.");
    rendered.rerender(<ReportEvidence apiBase="" review={{ ...data, source_duration_s: null }} />);
    expect(screen.getByRole("article", { name: "E02 · Moment 1" })).not.toHaveTextContent("Excluded from timeline");
    expect(fetch).not.toHaveBeenCalled();
  });
});
