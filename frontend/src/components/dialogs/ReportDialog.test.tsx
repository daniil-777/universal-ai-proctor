import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportDialog } from "./ReportDialog";

const harness = vi.hoisted(() => ({
  app: {} as Record<string, unknown>,
  fetch: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useApp: () => harness.app }));
vi.mock("@/lib/api", () => ({
  apiFetch: harness.fetch,
  mediaUrl: (base: string, route: string) => base + route,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  harness.fetch.mockReset();
  harness.app = {
    apiBase: "",
    sourceId: "source-A",
    sourceKind: "video",
    sourceReady: true,
    referenceName: "guidance.txt",
    revision: 4,
    preferencesRevision: 2,
    review: {
      source_id: "source-A",
      reference_key: "digest-A",
      review_version: 3,
      events: [],
      exceptions: [],
      checks: [],
    },
    guardianLog: [],
    chat: [],
    stages: [],
    serverVideoReady: true,
    caseName: "Inspection",
    monitor: { display: "Guardian" },
    model: { display: "Assistant" },
    liveMetrics: [],
    refreshReview: vi.fn(),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function view() {
  const rendered = render(
    <ReportDialog>
      <button>Open report</button>
    </ReportDialog>,
  );
  fireEvent.click(screen.getByText("Open report"));
  return rendered;
}
const pdfResponse = () =>
  new Response("%PDF-fixture", {
    status: 200, headers: { "Content-Type": "application/pdf" },
  });

describe("report snapshot ownership", () => {
  it("shows a blocked print window beside its action with other exports available", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    view();
    fireEvent.click(
      screen.getByRole("button", { name: "Detailed session print" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Print window was blocked",
    );
    expect(screen.getByRole("button", { name: "Prepare PDF" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Offline HTML" })).toBeEnabled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });
  it("prepares source/document/progress guarded files and avoids an automatic debrief call", async () => {
    harness.fetch.mockResolvedValue(pdfResponse());
    view();
    expect(harness.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    await screen.findByRole("button", { name: "Download PDF" });
    const query = new URL(harness.fetch.mock.calls[0][0], "http://localhost")
      .searchParams;
    expect(Object.fromEntries(query)).toEqual({
      source_id: "source-A",
      reference_key: "digest-A",
      review_version: "3",
      revision: "4",
      preferences_revision: "2",
    });
  });
  it("discards a delayed PDF when a different source replaces the current video", async () => {
    let resolve!: (value: Response) => void;
    harness.fetch.mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const rendered = view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    const signal = harness.fetch.mock.calls[0][1].signal as AbortSignal;
    harness.app = {
      ...harness.app,
      sourceId: "source-B",
      review: { ...(harness.app.review as object), source_id: "source-B" },
    };
    rendered.rerender(
      <ReportDialog>
        <button>Open report</button>
      </ReportDialog>,
    );
    await act(async () => {
      resolve(pdfResponse());
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });
  it("shows an actionable deadline failure and keeps offline HTML available", async () => {
    vi.useFakeTimers();
    harness.fetch.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          );
        }),
    );
    view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Report preparation timed out",
    );
    expect(screen.getByRole("button", { name: "Offline HTML" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });
  it("does not apply a delayed device share result to a replacement source", async () => {
    let resolveShare!: () => void;
    const share = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveShare = resolve;
        }),
    );
    const originalNavigator = navigator;
    vi.stubGlobal(
      "navigator",
      new Proxy(originalNavigator, {
        get(target, key) {
          if (key === "share") return share;
          if (key === "canShare") return () => true;
          return Reflect.get(target, key, target);
        },
      }),
    );
    harness.fetch.mockImplementation(async () => pdfResponse());
    const rendered = view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    await screen.findByRole("button", { name: "Share PDF" });
    fireEvent.click(screen.getByRole("button", { name: "Share PDF" }));
    expect(share).toHaveBeenCalledOnce();
    harness.app = {
      ...harness.app,
      sourceId: "source-B",
      review: { ...(harness.app.review as object), source_id: "source-B" },
    };
    rendered.rerender(
      <ReportDialog>
        <button>Open report</button>
      </ReportDialog>,
    );
    await act(async () => {
      resolveShare();
    });
    expect(
      screen.queryByText("Report handed to your device’s share menu."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
    expect(screen.getByRole("button", { name: "Prepare PDF" })).toBeEnabled();
  });
  it("invalidates prepared files on manual progress, goals or document updates", async () => {
    harness.fetch.mockImplementation(async () => pdfResponse());
    const rendered = view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    await screen.findByRole("button", { name: "Download PDF" });
    harness.app = { ...harness.app, preferencesRevision: 3 };
    rendered.rerender(
      <ReportDialog>
        <button>Open report</button>
      </ReportDialog>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
    await screen.findByRole("button", { name: "Download PDF" });
    await act(async () => {
      window.dispatchEvent(new Event("guidance-reference-updated"));
    });
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });
  it("explains an optional debrief deadline and allows a retry without claiming an assessment", async () => {
    vi.useFakeTimers();
    harness.fetch.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Canceled", "AbortError")),
            { once: true },
          );
        }),
    );
    view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare debrief" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Debrief preparation timed out",
    );
    expect(
      screen.getByRole("button", { name: "Prepare debrief" }),
    ).toBeEnabled();
    expect(screen.queryByText("Nothing recorded.")).toBeNull();
  });
  it("never attaches old-source or live-camera Guardian alerts to current incident clips", () => {
    harness.app.guardianLog = [
      {
        id: "old",
        sourceId: "source-old",
        sourceKind: "video",
        status: "alert",
        text: "Old source alert",
        ts: 1,
        videoS: 20,
      },
      {
        id: "camera",
        sourceId: "source-A",
        sourceKind: "camera",
        status: "alert",
        text: "Live input alert",
        ts: 2,
        videoS: 30,
      },
      {
        id: "current",
        sourceId: "source-A",
        sourceKind: "video",
        status: "alert",
        text: "Current source alert",
        ts: 3,
        videoS: 0,
      },
    ];
    view();
    expect(document.querySelectorAll("video")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Load alert clips" }));
    const videos = document.querySelectorAll("video");
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute("src")).toContain("source_id=source-A");
    expect(videos[0].getAttribute("src")).toContain("start_s=0.0");
    expect(videos[0].getAttribute("preload")).toBe("none");
    expect(screen.queryByText("Old source alert")).toBeNull();
  });

  it("withholds exports and debrief when a stale source's review is still present", () => {
    harness.app.review = {
      ...(harness.app.review as object),
      source_id: "old-source",
      exceptions: [{ title: "Wrong source issue", status: "open" }],
    };
    view();
    expect(screen.getByRole("button", { name: "Prepare PDF" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Prepare debrief" }),
    ).toBeDisabled();
    expect(screen.queryByText("Wrong source issue")).toBeNull();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("prioritizes explicitly not-met criteria and preserves confirmation origins", () => {
    harness.app.stages = [
      {
        id: "S1",
        name: "Initial",
        complete: true,
        confirmation: "manual",
        progress: 100,
        criteria: [
          {
            key: "unknown",
            label: "Unknown first criterion",
            status: "unknown",
          },
        ],
      },
      {
        id: "S2",
        name: "Final",
        complete: false,
        progress: 30,
        criteria: [
          {
            key: "failed",
            label: "Alignment not established",
            status: "not_met",
          },
          { key: "partial", label: "Partial verification", status: "partial" },
        ],
      },
    ];
    view();
    const priorities = screen.getByRole("region", {
      name: "Review priorities",
    });
    expect(priorities).toHaveTextContent("Alignment not established");
    expect(priorities).not.toHaveTextContent("Unknown first criterion");
    expect(screen.getByRole("img", { name: /Criterion status counts/ })).toHaveAttribute("aria-label", "Criterion status counts: Met: 0, Partial: 1, Not met: 1, Unknown: 1");
    expect(
      screen.getByRole("img", {
        name: "1 of 2 steps confirmed: 0 AI, 1 manual, 0 other, 1 unfinished",
      }),
    ).toBeInTheDocument();
  });

  it("does not interpret an empty workflow as a completed review", () => {
    view();
    expect(
      screen.getByRole("region", { name: "Review priorities" }),
    ).toHaveTextContent("Workflow criteria are not available");
    expect(screen.queryByText("0/0")).toBeNull();
    expect(
      screen.queryByText(/No outstanding items in the recorded review/),
    ).toBeNull();
  });

  it("does not label unfinished steps without criteria as confirmed", () => {
    harness.app.stages = [{ id: "S1", name: "Observe", complete: false, progress: 0, criteria: [] }];
    view();
    expect(screen.getByRole("heading", { name: "Review in progress." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recorded steps confirmed." })).toBeNull();
  });

  it("keeps session telemetry separate and validates a recorded debrief response", async () => {
    harness.app.rawMetrics = { Blood: 99 };
    harness.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          overall: { unsafe: "object" },
          done_properly: [],
          to_improve: [],
          qa_summary: "",
        }),
      ),
    );
    view();
    fireEvent.click(screen.getByRole("button", { name: "Prepare debrief" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "invalid recorded debrief",
      ),
    );
    expect(JSON.parse(harness.fetch.mock.calls[0][1].body)).not.toHaveProperty(
      "metrics",
    );
    expect(
      screen.getByText(/preparing it does not run new AI analysis/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare PDF" })).toBeEnabled();
  });
});

it("rejects an HTML error page returned with successful status instead of offering a broken PDF", async () => {
  harness.fetch.mockResolvedValue(new Response("<html>Error</html>", { headers: { "Content-Type": "text/html" } }));
  view();
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("unexpected report format");
  expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
});

it("rejects corrupt bytes even if the response claims to be a PDF", async () => {
  harness.fetch.mockResolvedValue(new Response("Not a PDF", { headers: { "Content-Type": "application/pdf" } }));
  view();
  fireEvent.click(screen.getByRole("button", { name: "Prepare PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid PDF");
  expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
});

it("opens the exact queued workflow step and follows a retained issue reference without mutations or requests", async () => {
  const stages = Array.from({ length: 5 }, (_, index) => ({ id: `step-${index}`, name: `Step ${index}`, complete: false,
    criteria: [{ key: "criterion", label: `Check ${index}`, status: "unknown" }], actions: [] }));
  const event = { id: "event-linked", source_id: "source-A", reference_key: "digest-A", occurred_at: 1000, video_time_s: 3,
    provenance: "operator", kind: "bookmark", status: "watch", summary: "Retained concern", concern: "", guidance: "", step_ids: ["step-4"], old_reference: false };
  const review = { ...(harness.app.review as object), events: [event], exceptions: [{ id: "issue", title: "Follow up", description: "Review", provenance: "operator", status: "open", event_id: event.id, history: [] }] };
  harness.app = { ...harness.app, stages, review };
  const before = JSON.stringify({ stages, review });
  view();
  Object.defineProperty(document.querySelector(".report-body"), "scrollTo", { value: vi.fn() });
  const target = document.querySelector<HTMLDetailsElement>('[data-report-step="step-4"]')!;
  expect(target.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Review step Step 4" }));
  expect(target.open).toBe(true);
  expect(target).toHaveFocus();
  fireEvent.click(screen.getAllByRole("button", { name: "View evidence E01" }).at(-1)!);
  await waitFor(() => expect(screen.getByRole("article", { name: "E01 · Retained concern" })).toHaveFocus());
  expect(JSON.stringify({ stages, review })).toBe(before);
  expect(harness.fetch).not.toHaveBeenCalled();
});

it("keeps escaped evidence cross-references consistent in detailed print and marks missing retained records", () => {
  const write = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() }, opener: {} } as unknown as Window);
  harness.app.review = { ...(harness.app.review as object), events: [{ id: "event-1", source_id: "source-A", reference_key: "digest-A",
    occurred_at: 1000, video_time_s: 1, provenance: "operator", kind: "bookmark", status: "ok", summary: "<script>unsafe</script>", concern: "", guidance: "", step_ids: [], old_reference: false }],
    exceptions: [{ id: "linked", title: "Linked", status: "open", description: "", provenance: "operator", event_id: "event-1", history: [] },
      { id: "missing", title: "Missing", status: "open", description: "", provenance: "operator", event_id: "gone", history: [] }] };
  view();
  fireEvent.click(screen.getByRole("button", { name: "Detailed session print" }));
  const html = write.mock.calls[0][0] as string;
  expect(html).toContain('href="#evidence-event-1">View evidence E01');
  expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
  expect(html).toContain("Linked evidence is not retained in this snapshot.");
  expect(html).not.toContain("<script>unsafe</script>");
  expect(harness.fetch).not.toHaveBeenCalled();
});
