import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppState } from "./store";
import { useGeneralGuidance } from "./useGeneralGuidance";
const mock = vi.hoisted(() => ({
  app: null as unknown as AppState,
  fetch: vi.fn(),
  speak: vi.fn(),
  sampleRecent: vi.fn(() => []),
  grab: vi.fn(),
  time: 1,
}));
vi.mock("./store", () => ({ useApp: () => mock.app }));
vi.mock("./api", () => ({ apiFetch: mock.fetch }));
vi.mock("./speech", () => ({ speak: mock.speak }));
vi.mock("./frameBus", () => ({
  clearFrames: vi.fn(),
  bufferFrame: vi.fn(),
  grabFrame: mock.grab,
  recentFrameSamples: mock.sampleRecent,
  sampleVideoOverview: vi.fn(),
}));
const response = (status = "ok", concern = "") =>
  new Response(
    JSON.stringify({
      ok: true,
      observation: { status, concern, summary: "Visible process" },
      ms: 800,
      used_frames: 1,
    }),
  );
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  mock.time = 1;
  mock.fetch.mockReset();
  mock.speak.mockReset();
  mock.sampleRecent.mockReset().mockReturnValue([]);
  mock.grab.mockReset().mockImplementation(() => ({ b64: "jpeg", currentS: mock.time }));
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  mock.app = {
    running: true,
    sourceReady: true,
    sourceId: "a",
    sourceKind: "camera",
    liveStream: {},
    timelineEpoch: 0,
    revision: 1,
    apiBase: "",
    preferencesReady: true,
    preferencesRevision: 2,
    model: { provider: "openai", model_id: "gpt-4o" },
    workflow: { steps: [{}] },
    monitor: {
      active: true,
      method: "Frames",
      mosaicN: 2,
      intervalSecs: 2,
      windowSecs: 5,
      nFrames: 4,
      provider: "openai",
      modelId: "gpt-4o",
      voiceOn: true,
    },
    analysis: {
      visionDetail: "auto",
      method: "Sampling",
      mosaicN: 2,
      compress: true,
    },
    experience: "Beginner",
    useMock: false,
    setGuardianBusy: vi.fn(),
    applyAnalysis: vi.fn(),
    pushGuardianLog: vi.fn(),
    addLog: vi.fn(),
    setMonitorAlert: vi.fn(),
    setAnalysisError: vi.fn(),
    refreshPreferences: vi.fn(),
  } as unknown as AppState;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("uses start-to-start cadence instead of adding response latency to the interval", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(800);
  await act(async () => {
    d.resolve(response());
    await d.promise;
  });
  await advance(1199);
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  expect(
    JSON.parse(mock.fetch.mock.calls[0][1].body).preferences_revision,
  ).toBe(2);
});
it("coalesces repeated manual checks during a pending response into one fresh check", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  act(() => {
    for (let i = 0; i < 8; i++)
      window.dispatchEvent(new Event("guidance-analyze-now"));
  });
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  mock.time = 4;
  await act(async () => {
    d.resolve(response());
    await d.promise;
  });
  await advance(1);
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mock.fetch.mock.calls[1][1].body).current_s).toBe(4);
});
it("escalates watch to alert with unchanged wording and avoids duplicate alerts", async () => {
  mock.fetch
    .mockResolvedValueOnce(response("watch", "Inspect the tool"))
    .mockResolvedValueOnce(response("alert", "Inspect the tool"))
    .mockResolvedValue(response("alert", "Inspect the tool"));
  renderHook(() => useGeneralGuidance());
  await advance(0);
  await advance(4000);
  expect(mock.app.setMonitorAlert).toHaveBeenCalledTimes(2);
  expect(mock.app.setMonitorAlert).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "alert" }),
  );
  expect(mock.speak).toHaveBeenLastCalledWith("", "Inspect the tool", {
    priority: true,
  });
});
it.each(["goals", "model", "source"])(
  "cancels %s changes and ignores a late response even if fetch ignores abort",
  async (kind) => {
    const d = deferred();
    mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response());
    const h = renderHook(() => useGeneralGuidance());
    const signal = mock.fetch.mock.calls[0][1].signal;
    mock.app = {
      ...mock.app,
      ...(kind === "goals"
        ? { preferencesRevision: 3 }
        : kind === "source"
          ? { sourceId: "b" }
          : { monitor: { ...mock.app.monitor, modelId: "different" } }),
    };
    h.rerender();
    await advance(0);
    await act(async () => {
      d.resolve(response("alert", "Old warning"));
      await d.promise;
    });
    expect(signal.aborted).toBe(true);
    expect(mock.app.applyAnalysis).toHaveBeenCalledTimes(1);
    expect(mock.speak).not.toHaveBeenCalled();
  },
);
it("recovers from transient server failures with bounded backoff", async () => {
  mock.fetch
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }),
    )
    .mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(0);
  await advance(2000);
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  await advance(3999);
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(mock.fetch).toHaveBeenCalledTimes(3);
  expect(mock.app.applyAnalysis).toHaveBeenCalledTimes(1);
});
it("waits for stored goals before making an observation", async () => {
  mock.app = { ...mock.app, preferencesReady: false };
  mock.fetch.mockResolvedValue(response());
  const h = renderHook(() => useGeneralGuidance());
  await advance(1500);
  expect(mock.fetch).not.toHaveBeenCalled();
  mock.app = { ...mock.app, preferencesReady: true };
  h.rerender();
  await advance(0);
  expect(mock.fetch).toHaveBeenCalledTimes(1);
});
it("aborts when hidden and does not apply a late warning", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  Object.defineProperty(document, "hidden", {
    value: true,
    configurable: true,
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => {
    d.resolve(response("alert", "Old warning"));
    await d.promise;
  });
  await advance(5000);
  expect(mock.app.applyAnalysis).not.toHaveBeenCalled();
  expect(mock.fetch).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await advance(0);
  expect(mock.app.applyAnalysis).toHaveBeenCalledTimes(1);
});
it("aborts a hung network request, displays a timeout and releases the busy state", async () => {
  mock.fetch.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  );
  renderHook(() => useGeneralGuidance());
  await advance(50000);
  expect(mock.app.setAnalysisError).toHaveBeenCalledWith(
    expect.stringContaining("timed out"),
  );
  expect(mock.app.setGuardianBusy).toHaveBeenLastCalledWith(false);
});

it("honors Guardian mosaic settings independently of chat sampling settings", async () => {
  mock.app = {
    ...mock.app,
    monitor: { ...mock.app.monitor, method: "Mosaic", mosaicN: 3 },
  };
  mock.fetch.mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(0);
  const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
  expect(body.processing).toBe("mosaic");
  expect(body.mosaic_n).toBe(3);
  expect(body.n_samples).toBe(9);
  expect(mock.sampleRecent).toHaveBeenCalledWith(5, 9, false);
});
it("requests recent motion views in Guardian Frames mode within the same image budget", async () => {
  mock.fetch.mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(0);
  expect(mock.sampleRecent).toHaveBeenCalledWith(5, 4, true);
  const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
  expect(body.n_samples).toBe(4);
  expect(body.processing).toBe("sampling");
});

it("honors a voice-off change while the observation is pending", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise);
  const h = renderHook(() => useGeneralGuidance());
  mock.app = { ...mock.app, monitor: { ...mock.app.monitor, voiceOn: false } };
  h.rerender();
  await act(async () => {
    d.resolve(response("alert", "Inspect this concern"));
    await d.promise;
  });
  expect(mock.app.setMonitorAlert).toHaveBeenCalledWith(
    expect.objectContaining({ status: "alert" }),
  );
  expect(mock.speak).not.toHaveBeenCalled();
});

it("samples a complete server-owned video window immediately after a seek", async () => {
  mock.app = {
    ...mock.app,
    sourceKind: "video",
    serverVideoReady: true,
    liveStream: null,
    timelineEpoch: 3,
    monitor: { ...mock.app.monitor, windowSecs: 8 },
  } as AppState;
  mock.fetch.mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(0);
  const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
  expect(body.frames_b64).toEqual([]);
  expect(body.frame_times_s).toEqual([]);
  expect(body.window_s).toBe(8);
  expect(body.n_samples).toBe(4);
});

it("keeps locally captured frames when a server copy is unavailable", async () => {
  mock.app = {
    ...mock.app,
    sourceKind: "video",
    serverVideoReady: false,
    liveStream: null,
  } as AppState;
  mock.fetch.mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  await advance(0);
  const body = JSON.parse(mock.fetch.mock.calls[0][1].body);
  expect(body.frames_b64).toEqual(["jpeg"]);
  expect(body.frame_times_s).toEqual([1]);
});

it("covers elapsed camera footage when inference takes longer than the configured window", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response());
  renderHook(() => useGeneralGuidance());
  mock.time = 9;
  await advance(8000);
  await act(async () => { d.resolve(response()); await d.promise; });
  mock.time = 10;
  await advance(250);
  const body = JSON.parse(mock.fetch.mock.calls[1][1].body);
  expect(body.window_s).toBe(9.5);
  expect(body.n_samples).toBe(4);
  expect(mock.sampleRecent).toHaveBeenLastCalledWith(9.5, 4, true);
});

it("labels delayed camera warnings as an earlier view in both the alert and voice", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise);
  renderHook(() => useGeneralGuidance());
  mock.time = 10;
  await advance(9000);
  await act(async () => { d.resolve(response("alert", "Inspect the tool")); await d.promise; });
  expect(mock.app.setMonitorAlert).toHaveBeenCalledWith(expect.objectContaining({
    status: "alert", text: "Earlier view (9 s ago): Inspect the tool",
  }));
  expect(mock.speak).toHaveBeenCalledWith("", "In the earlier view, Inspect the tool", { priority: true });
  expect(mock.app.applyAnalysis).toHaveBeenCalledTimes(1);
});

it("avoids discarded browser captures while a recorded server video is analyzed", async () => {
  mock.app = { ...mock.app, sourceKind: "video", serverVideoReady: true, liveStream: null } as AppState;
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise);
  renderHook(() => useGeneralGuidance());
  await advance(1000);
  expect(mock.grab).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mock.fetch.mock.calls[0][1].body).frames_b64).toEqual([]);
});

it("refreshes an earlier-view alert when a fresh check confirms it without repeating the voice", async () => {
  const d = deferred();
  mock.fetch.mockReturnValueOnce(d.promise).mockResolvedValue(response("alert", "Inspect the tool"));
  renderHook(() => useGeneralGuidance());
  mock.time = 10;
  await advance(9000);
  await act(async () => { d.resolve(response("alert", "Inspect the tool")); await d.promise; });
  await advance(250);
  expect(mock.app.setMonitorAlert).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Inspect the tool" }));
  expect(mock.speak).toHaveBeenCalledTimes(1);
});

it("does not infer new video instructions while a completed recap owns the uploaded source", async () => {
  mock.app = { ...mock.app, sourceKind: "video", serverVideoReady: true, liveStream: null, workflow: { steps: [] }, recap: { active: false, ownsUploadedAnalysis: true } } as unknown as AppState;
  mock.fetch.mockResolvedValue(response());
  const hook = renderHook(() => useGeneralGuidance());
  await advance(5000);
  act(() => window.dispatchEvent(new Event("guidance-analyze-now")));
  expect(mock.fetch).not.toHaveBeenCalled();
  expect(mock.grab).not.toHaveBeenCalled();
  mock.app = { ...mock.app, recap: { ownsUploadedAnalysis: false } } as AppState;
  hook.rerender(); await advance(0);
  expect(mock.fetch).toHaveBeenCalledOnce();
});

it("aborts a pending uploaded observation when recap ownership begins", async () => {
  mock.app = { ...mock.app, sourceKind: "video", serverVideoReady: true, liveStream: null } as AppState;
  const delayed = deferred(); mock.fetch.mockReturnValue(delayed.promise);
  const hook = renderHook(() => useGeneralGuidance());
  const signal = mock.fetch.mock.calls[0][1].signal;
  mock.app = { ...mock.app, recap: { ownsUploadedAnalysis: true } } as AppState;
  hook.rerender(); expect(signal.aborted).toBe(true);
  await act(async () => { delayed.resolve(response()); await delayed.promise; });
  await advance(5000);
  expect(mock.app.applyAnalysis).not.toHaveBeenCalled(); expect(mock.fetch).toHaveBeenCalledOnce();
});
