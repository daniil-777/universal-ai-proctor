import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionReview } from "./useSessionReview";
const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mock.fetch }));
const data = (source = "source-a", version = 1) => ({
  ok: true,
  source_id: source,
  reference_key: "doc-a",
  review_version: version,
  job: { operator: "Jane", asset: "", work_order: "" },
  checks: [],
  events: [],
  exceptions: [],
  retention: {},
  notice: "",
});
const response = (source = "source-a", version = 1) =>
  new Response(JSON.stringify(data(source, version)));
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
beforeEach(() => mock.fetch.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("waits for a ready source then saves only with matching source/document/version", async () => {
  mock.fetch
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response("source-a", 2));
  const h = renderHook(
    ({ ready }) => useSessionReview("", "source-a", ready, 1, null),
    { initialProps: { ready: false } },
  );
  expect(mock.fetch).not.toHaveBeenCalled();
  h.rerender({ ready: true });
  await flush();
  await act(() =>
    h.result.current.saveReadiness({ checks: [{ id: "tool", checked: true }] }),
  );
  expect(JSON.parse(mock.fetch.mock.calls[1][1].body)).toEqual({
    checks: [{ id: "tool", checked: true }],
    source_id: "source-a",
    reference_key: "doc-a",
    review_version: 1,
  });
  expect(h.result.current.review.review_version).toBe(2);
});
it("aborts and ignores a delayed response after switching inputs", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch
    .mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(response("source-b", 1));
  const h = renderHook(
    ({ source }) => useSessionReview("", source, true, 1, null),
    { initialProps: { source: "source-a" } },
  );
  const signal = mock.fetch.mock.calls[0][1].signal;
  h.rerender({ source: "source-b" });
  await flush();
  await act(async () => resolve(response("source-a", 90)));
  expect(signal.aborted).toBe(true);
  expect(h.result.current.review.source_id).toBe("source-b");
});
it("does not replace a newly saved review with an older read", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch
    .mockResolvedValueOnce(response())
    .mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(response("source-a", 3));
  const h = renderHook(() => useSessionReview("", "source-a", true, 1, null));
  await flush();
  act(() => window.dispatchEvent(new Event("focus")));
  await act(() =>
    h.result.current.raiseReviewException({ title: "Missing part" }),
  );
  await act(async () => resolve(response("source-a", 1)));
  expect(h.result.current.review.review_version).toBe(3);
});
it("refreshes after a version conflict without accepting a failed operator decision", async () => {
  mock.fetch
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "Review changed" }), {
        status: 409,
      }),
    )
    .mockResolvedValueOnce(response("source-a", 2));
  const h = renderHook(() => useSessionReview("", "source-a", true, 1, null));
  await flush();
  await act(async () => {
    await expect(
      h.result.current.updateReviewException("issue", "resolved", "Fixed"),
    ).rejects.toThrow("Review changed");
  });
  await flush();
  expect(h.result.current.review.review_version).toBe(2);
  expect(h.result.current.reviewBusy).toBe(false);
});
it("coalesces an observation arriving during a read into one fresh follow-up", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch
    .mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(response("source-a", 2));
  const h = renderHook(
    ({ observation }) => useSessionReview("", "source-a", true, 1, observation),
    { initialProps: { observation: 1 } },
  );
  h.rerender({ observation: 2 });
  h.rerender({ observation: 3 });
  await act(async () => resolve(response()));
  await flush();
  expect(mock.fetch).toHaveBeenCalledTimes(2);
  expect(h.result.current.review.review_version).toBe(2);
});
it("loads images lazily and uses the latest visibility when a pending metadata read finishes", async () => {
  let resolve!: (r: Response) => void;
  mock.fetch
    .mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(response("source-a", 2));
  const h = renderHook(() => useSessionReview("", "source-a", true, 1, null));
  expect(mock.fetch.mock.calls[0][0]).toContain("include_images=false");
  act(() => h.result.current.setReviewImagesEnabled(true));
  await act(async () => resolve(response()));
  await flush();
  expect(mock.fetch.mock.calls[1][0]).toContain("include_images=true");
});
