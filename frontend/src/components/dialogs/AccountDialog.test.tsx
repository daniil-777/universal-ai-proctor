import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountDialog from "./AccountDialog";

const harness = vi.hoisted(() => ({
  app: {} as Record<string, unknown>,
  account: "A",
  fetch: vi.fn(),
}));
vi.mock("@/lib/store", () => ({ useApp: () => harness.app }));
vi.mock("@/lib/api", () => ({ apiFetch: harness.fetch }));

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const training = (account: string) => ({
  ok: true,
  summary: {
    sessions: 1,
    total_steps: 1,
    confirmed_steps: 0,
    ai_confirmed_steps: 0,
    operator_confirmed_steps: 0,
    open_exceptions: 0,
    total_visual_checks: 1,
  },
  history: [
    {
      id: `run-${account}`,
      saved_at: 1700000000000,
      title: `Run ${account}`,
      source_name: `Source ${account}`,
      source_kind: "video",
      reference_name: "guidance.txt",
      steps: 1,
      confirmed_steps: 0,
      ai_confirmed_steps: 0,
      operator_confirmed_steps: 0,
      open_exceptions: 0,
      visual_checks: 1,
      duration_s: 20,
    },
  ],
});
const report = (account: string) => ({
  ok: true,
  report: {
    id: `run-${account}`,
    title: `Run ${account}`,
    handoff: {
      source: { name: `Source ${account}` },
      reference: { filename: "guidance.txt" },
      progress: [
        {
          id: "step",
          name: `Private step ${account}`,
          complete: false,
          confirmation: null,
          criteria: [],
        },
      ],
      open_exceptions: [],
      operator_goals: "",
    },
  },
});
function accountReply(url: string) {
  if (url.endsWith("/me"))
    return reply({
      ok: true,
      user: {
        id: harness.account,
        email: `${harness.account}@example.test`,
        name: `Operator ${harness.account}`,
        created_at: 1700000000000,
      },
      deployment: "local",
    });
  if (url.endsWith("/training")) return reply(training(harness.account));
  if (url.endsWith(`/training/run-${harness.account}`))
    return reply(report(harness.account));
  throw new Error(`Unexpected request: ${url}`);
}
async function openWorkspace() {
  fireEvent.click(screen.getByRole("button", { name: "Account and training" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled(),
  );
}
async function openResult() {
  fireEvent.click(screen.getByRole("button", { name: "View result" }));
  await screen.findByText(`Private step ${harness.account} · Unfinished`);
  const details = screen.getByRole("region", {
    name: `Saved result details: Run ${harness.account}`,
  });
  expect(details).toHaveFocus();
  expect(details.previousElementSibling?.tagName).toBe("ARTICLE");
  expect(details.previousElementSibling).toHaveTextContent(
    `Run ${harness.account}`,
  );
}

beforeEach(() => {
  harness.account = "A";
  harness.app = {
    apiBase: "",
    sourceReady: false,
    sourceId: "source-A",
    review: null,
  };
  harness.fetch.mockReset();
  harness.fetch.mockImplementation(async (url: string) => accountReply(url));
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:private-report");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("saved account report downloads", () => {
  it("shows the PDF font error and downloads the available offline HTML report", async () => {
    const fontError =
      "This PDF contains unsupported characters. Use the offline HTML report to preserve the original text.";
    harness.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/report.pdf"))
        return reply({ ok: false, error: fontError }, 422);
      if (url.endsWith("/report.html"))
        return new Response("<!doctype html><title>保存された結果</title>", {
          headers: { "Content-Type": "text/html" },
        });
      return accountReply(url);
    });
    render(<AccountDialog />);
    await openWorkspace();
    expect(screen.getByText(/review saved runs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(fontError);
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Offline HTML" }));
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock
      .instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("process-guide-report.html");
    expect(anchor.href).toBe("blob:private-report");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private-report");
  });

  it("clears private account history and selected results when the current download session expires", async () => {
    harness.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/report.pdf")
        ? reply(
            { ok: false, error: "Your session expired. Sign in again." },
            401,
          )
        : accountReply(url),
    );
    render(<AccountDialog />);
    await openWorkspace();
    await openResult();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Sign in again.",
    );
    expect(screen.queryByText("Operator A")).toBeNull();
    expect(screen.queryByText("Run A")).toBeNull();
    expect(screen.queryByText(/Private step A/)).toBeNull();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it.each(["response", "error body"])(
    "ignores a stale 401 %s after another account owns the reopened workspace",
    async (stage) => {
      let resolve!: (value: unknown) => void;
      let oldSignal!: AbortSignal;
      harness.fetch.mockImplementation(
        (url: string, options: { signal: AbortSignal }) => {
          if (url.endsWith("/report.pdf")) {
            oldSignal = options.signal;
            if (stage === "response")
              return new Promise<Response>((done) => {
                resolve = done;
              });
            return Promise.resolve({
              ok: false,
              status: 401,
              json: () =>
                new Promise((done) => {
                  resolve = done;
                }),
            });
          }
          return Promise.resolve(accountReply(url));
        },
      );
      render(<AccountDialog />);
      await openWorkspace();
      fireEvent.click(screen.getByRole("button", { name: "PDF" }));
      await waitFor(() => expect(resolve).toBeDefined());
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      harness.account = "B";
      await openWorkspace();
      await openResult();
      await act(async () =>
        resolve(
          stage === "response"
            ? reply({ ok: false, error: "Old account session expired." }, 401)
            : { ok: false, error: "Old account session expired." },
        ),
      );
      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByText("Operator B")).toBeInTheDocument();
      expect(
        screen.getByText("Private step B · Unfinished"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    },
  );

  it("waits for the renderer budget, then shows an actionable download deadline", async () => {
    harness.fetch.mockImplementation(
      (url: string, options: { signal: AbortSignal }) => {
        if (url.endsWith("/report.pdf"))
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Canceled", "AbortError")),
              { once: true },
            );
          });
        return Promise.resolve(accountReply(url));
      },
    );
    render(<AccountDialog />);
    await openWorkspace();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Saved report download timed out. Try again or use Offline HTML.",
    );
    expect(screen.getByRole("button", { name: "Offline HTML" })).toBeEnabled();
  });

  it("uses a readable fallback for a non-JSON download error", async () => {
    harness.fetch.mockImplementation(async (url: string) =>
      url.endsWith("/report.pdf")
        ? new Response("Upstream temporarily unavailable", { status: 503 })
        : accountReply(url),
    );
    render(<AccountDialog />);
    await openWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Saved report could not be downloaded. Please try again.",
    );
    expect(screen.getByText("Operator A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Offline HTML" })).toBeEnabled();
  });
});
