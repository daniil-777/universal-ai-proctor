import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useGuidancePreferences } from "./useGuidancePreferences";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mock.fetch }));
const response = (goals = "", revision = 0, status = 200) => new Response(JSON.stringify(status === 200 ? { ok: true, operator_goals: goals, preferences_revision: revision } : { error: "Guidance goals changed; refresh and retry." }), { status });
const flush = () => act(async () => { await Promise.resolve(); });
beforeEach(() => { mock.fetch.mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("loads session goals and saves with a version, including clearing", async () => {
  mock.fetch.mockResolvedValueOnce(response("Explain in French", 1)).mockResolvedValueOnce(response("", 2));
  const h = renderHook(() => useGuidancePreferences("")); await flush();
  expect(h.result.current.operatorGoals).toBe("Explain in French");
  await act(() => h.result.current.saveOperatorGoals("  ", 1));
  expect(JSON.parse(mock.fetch.mock.calls[1][1].body)).toEqual({ operator_goals: "", preferences_revision: 1 });
  expect(h.result.current.operatorGoals).toBe(""); expect(h.result.current.preferencesRevision).toBe(2);
});
it("retains saved goals after a failed save and rejects oversized goals locally", async () => {
  mock.fetch.mockResolvedValueOnce(response("Original", 1)).mockResolvedValueOnce(response("", 0, 409));
  const h = renderHook(() => useGuidancePreferences("")); await flush();
  await act(async () => { await expect(h.result.current.saveOperatorGoals("Draft", 0)).rejects.toThrow("goals changed"); });
  expect(h.result.current.operatorGoals).toBe("Original");
  await expect(h.result.current.saveOperatorGoals("x".repeat(2001))).rejects.toThrow("2,000"); expect(mock.fetch).toHaveBeenCalledTimes(2);
});
it("ignores a late response from an earlier API base", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch.mockReturnValueOnce(new Promise<Response>(r => { resolve = r; })).mockResolvedValueOnce(response("New session", 2));
  const h = renderHook(({ base }) => useGuidancePreferences(base), { initialProps: { base: "a" } });
  const signal = mock.fetch.mock.calls[0][1].signal; h.rerender({ base: "b" }); await flush();
  await act(async () => { resolve(response("Old session", 9)); });
  expect(signal.aborted).toBe(true); expect(h.result.current.operatorGoals).toBe("New session");
});
it("refreshes saved goals on focus without replacing a newer save with an old read", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch.mockResolvedValueOnce(response("Original", 1)).mockReturnValueOnce(new Promise<Response>(r => { resolve = r; })).mockResolvedValueOnce(response("Updated", 2));
  const h = renderHook(() => useGuidancePreferences("")); await flush();
  act(() => window.dispatchEvent(new Event("focus")));
  await act(() => h.result.current.saveOperatorGoals("Updated", 1));
  await act(async () => resolve(response("Original", 1)));
  expect(h.result.current.operatorGoals).toBe("Updated");
});
it("reports load failure and recovers after retry", async () => {
  mock.fetch.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response("Recovered", 3));
  const h = renderHook(() => useGuidancePreferences("")); await flush(); expect(h.result.current.preferencesReady).toBe(false);
  expect(h.result.current.preferencesError).toBe("Offline");
  await act(() => h.result.current.refreshPreferences()); expect(h.result.current.preferencesReady).toBe(true);
});
