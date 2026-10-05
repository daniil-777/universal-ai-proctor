import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionMemory } from "./useSessionMemory";

type MemoryFixture = {
  apiBase: string; sourceId: string; revision: number; timelineEpoch: number;
  currentStageId: string; stages: { id: string; name: string }[];
  guardianLog: { ts: number; status: string; text: string; videoS: number }[];
  sessionEvents: { ts: number; videoS: number; type: string; text: string }[];
  sessionDigest: string; setSessionDigest: ReturnType<typeof vi.fn>;
  addLog: ReturnType<typeof vi.fn>; pushSessionEvent: ReturnType<typeof vi.fn>;
};
const mocks = vi.hoisted(() => ({ app: null as MemoryFixture, fetch: vi.fn() }));
vi.mock("./store", () => ({ useApp: () => mocks.app }));
vi.mock("./api", () => ({ apiFetch: mocks.fetch }));
vi.mock("./frameBus", () => ({ grabFrame: () => ({ currentS: 12 }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  mocks.fetch.mockReset();
  mocks.app = {
    apiBase: "", sourceId: "source-a", revision: 1, timelineEpoch: 0,
    currentStageId: "S1", stages: [{ id: "S1", name: "Prepare" }],
    guardianLog: [{ ts: 100_001, status: "watch", text: "Inspect work area", videoS: 2 }],
    sessionEvents: [], sessionDigest: "", setSessionDigest: vi.fn(),
    addLog: vi.fn(), pushSessionEvent: vi.fn(),
  };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}
const response = (digest = "Inspect the work area.") => new Response(JSON.stringify({ ok: true, digest }), { status: 200 });

it("retains observations that arrive while a digest is pending", async () => {
  const first = deferred();
  mocks.fetch.mockReturnValueOnce(first.promise).mockResolvedValue(response("New event retained"));
  const hook = renderHook(() => useSessionMemory());
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  mocks.app = { ...mocks.app, guardianLog: [...mocks.app.guardianLog, { ts: 175_010, status: "watch", text: "A later observation", videoS: 8 }] };
  hook.rerender();
  await act(async () => { first.resolve(response()); await first.promise; });
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).events).toEqual(["[video 0:08] watch: A later observation"]);
  hook.unmount();
});

it("retains a distinct observation with the same millisecond timestamp", async () => {
  const first = deferred();
  mocks.fetch.mockReturnValueOnce(first.promise).mockResolvedValue(response());
  const hook = renderHook(() => useSessionMemory());
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  mocks.app = { ...mocks.app, guardianLog: [...mocks.app.guardianLog, {
    ts: 100_001, status: "watch", text: "A simultaneous new observation", videoS: 3,
  }] };
  hook.rerender();
  await act(async () => { first.resolve(response()); await first.promise; });
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).events).toEqual(["[video 0:03] watch: A simultaneous new observation"]);
  hook.unmount();
});

it.each(["sourceId", "revision", "timelineEpoch"])("rejects a late digest after %s changes, even if transport ignores abort", async (field) => {
  const request = deferred();
  mocks.fetch.mockReturnValue(request.promise);
  const hook = renderHook(() => useSessionMemory());
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  mocks.app = { ...mocks.app, [field]: field === "sourceId" ? "source-b" : 2 };
  hook.rerender();
  expect(signal.aborted).toBe(true);
  mocks.app.setSessionDigest.mockClear();
  await act(async () => { request.resolve(response("Stale summary")); await request.promise; });
  expect(mocks.app.setSessionDigest).not.toHaveBeenCalled();
  expect(mocks.app.addLog).not.toHaveBeenCalled();
  hook.unmount();
});

it("aborts and prevents updates after unmount", async () => {
  const request = deferred();
  mocks.fetch.mockReturnValue(request.promise);
  const hook = renderHook(() => useSessionMemory());
  await act(() => vi.advanceTimersByTimeAsync(75_000));
  const signal = mocks.fetch.mock.calls[0][1].signal as AbortSignal;
  hook.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { request.resolve(response()); await request.promise; });
  expect(mocks.app.setSessionDigest).not.toHaveBeenCalled();
});

it("skips hidden-tab requests and does not invent source-change stage transitions", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const hook = renderHook(() => useSessionMemory());
  await act(() => vi.advanceTimersByTimeAsync(150_000));
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.app = { ...mocks.app, sourceId: "source-b", currentStageId: "S2" };
  hook.rerender();
  expect(mocks.app.pushSessionEvent).not.toHaveBeenCalled();
  hook.unmount();
});
