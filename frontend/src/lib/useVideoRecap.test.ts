import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { narrationWindow, useVideoRecap } from "./useVideoRecap";
import { recapFixture } from "./videoSummaryTestFixture";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), speak: vi.fn(), stop: vi.fn(), download: vi.fn() }));
vi.mock("./api", () => ({ apiFetch: mocks.fetch }));
vi.mock("./speech", () => ({ speak: mocks.speak, stopNarration: mocks.stop }));
vi.mock("./reportShare", () => ({ downloadReport: mocks.download }));
const inputs = { apiBase: "", sourceId: "source-A", sourceReady: true, serverVideoReady: true, sourceKind: "video", definitionKey: "guide-definition", preferencesRevision: 1, useMock: false, provider: "openai", modelId: "test-model" };
const json = (data: unknown) => {
  const body = JSON.stringify(data);
  const response = new Response(body, { headers: { "Content-Type": "application/json" } });
  // Supply the standard Blob.text() behavior missing from jsdom so this fixture
  // reaches the download's identity check consistently in every worker order.
  response.blob = async () => {
    const file = new Blob([body], { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => body });
    return file;
  };
  return response;
};
const plan = { source_id: "source-A", reference_key: "reference-A", source_name: "Synthetic test video.mp4", duration_s: 6, mode: "detailed", window_s: 6, total_windows: 1, frames_per_window: 9, estimated_model_calls: 3, audio_available: true, max_duration_s: 3600 };
beforeEach(() => { Object.values(mocks).forEach(mock => mock.mockReset()); });

describe("source-owned video recap", () => {
  it("preflights without starting work, and sends explicit domain/audio choices only at Start", async () => {
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => url.includes("/plan?") ? json({ ok: true, plan }) : init?.method === "POST" ? json({ ok: true, job: recapFixture({ status: "queued" }) }) : json({ ok: true, job: null }));
    const hook = renderHook(() => useVideoRecap(inputs));
    act(() => hook.result.current.openRecap()); await waitFor(() => expect(hook.result.current.plan).not.toBeNull());
    expect(mocks.fetch.mock.calls.some(call => call[1]?.method === "POST")).toBe(false);
    act(() => { hook.result.current.setDomainOverride("dance"); hook.result.current.setIncludeAudio(true); });
    await act(() => hook.result.current.start());
    const post = mocks.fetch.mock.calls.find(call => call[1]?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({ source_id: "source-A", reference_key: "reference-A", domain_override: "dance", include_audio: true, model_id: "test-model" });
    hook.unmount();
  });
  it("aborts an old source read and refuses its late response", async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; })).mockResolvedValue(json({ ok: true, job: null }));
    const hook = renderHook(props => useVideoRecap(props), { initialProps: inputs });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    hook.rerender({ ...inputs, sourceId: "source-B" }); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(json({ ok: true, job: recapFixture() })); });
    expect(hook.result.current.job).toBeNull(); expect(hook.result.current.narrationEnabled).toBe(false); hook.unmount();
  });
  it("narrates only an accepted elapsed window and invalidates speech on pause or source change", async () => {
    const job = recapFixture({ source: { ...recapFixture().source, duration_s: 18 } });
    mocks.fetch.mockResolvedValue(json({ ok: true, job }));
    const hook = renderHook(() => useVideoRecap(inputs)); await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    act(() => { hook.result.current.setNarrationEnabled(true); hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 0, playing: true }); });
    expect(mocks.speak).not.toHaveBeenCalled();
    act(() => hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 6, playing: true }));
    expect(mocks.speak).toHaveBeenCalledTimes(1); const opts = mocks.speak.mock.calls[0][2]; expect(opts.channel).toBe("narration"); expect(opts.isCurrent()).toBe(true);
    act(() => hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 6.5, playing: false })); expect(opts.isCurrent()).toBe(false);
    act(() => hook.result.current.setNarrationEnabled(false)); expect(mocks.stop).toHaveBeenCalled(); hook.unmount();
  });
  it("does not replay stale windows after a seek and never selects a future window", () => {
    const job = recapFixture(); expect(narrationWindow(job, 5.999)).toBeUndefined();
    expect(narrationWindow(job, 6)?.id).toBe("W0001"); expect(narrationWindow(job, 13)).toBeUndefined(); expect(narrationWindow(job, 6, 6)).toBeUndefined();
  });
  it("waits for actual completion after video end before opening the final recap", async () => {
    let current = recapFixture({ status: "analyzing", summary: null });
    mocks.fetch.mockImplementation(async () => json({ ok: true, job: current }));
    const hook = renderHook(() => useVideoRecap(inputs)); await waitFor(() => expect(hook.result.current.active).toBe(true));
    act(() => hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 6, playing: false, ended: true }));
    expect(hook.result.current.open).toBe(false); expect(hook.result.current.awaitingSummary).toBe(true);
    current = recapFixture(); await act(() => hook.result.current.refresh()); await waitFor(() => expect(hook.result.current.open).toBe(true)); hook.unmount();
  });
  it("adopts the new immutable retry ID and rejects a mismatched downloaded result", async () => {
    mocks.fetch.mockImplementation(async (url: string) => url.endsWith("/retry") ? json({ ok: true, job: recapFixture({ id: "retry-B" }) }) : url.endsWith("report.json") ? json(recapFixture({ id: "wrong-file" })) : json({ ok: true, job: recapFixture({ status: "partial" }) }));
    const hook = renderHook(() => useVideoRecap(inputs)); await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    await act(() => hook.result.current.retry()); expect(hook.result.current.job?.id).toBe("retry-B");
    await act(() => hook.result.current.download()); expect(hook.result.current.error).toContain("does not match"); expect(mocks.download).not.toHaveBeenCalled(); hook.unmount();
  });
  it("keeps a pinned model snapshot while Demo mode stops voice and prevents new paid work", async () => {
    mocks.fetch.mockResolvedValue(json({ ok: true, job: recapFixture() }));
    const hook = renderHook(props => useVideoRecap(props), { initialProps: inputs });
    await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    act(() => hook.result.current.setNarrationEnabled(true));
    hook.rerender({ ...inputs, modelId: "another-model", useMock: true });
    expect(hook.result.current.job?.model.model_id).toBe("test-model");
    expect(hook.result.current.eligible).toBe(false);
    await waitFor(() => expect(hook.result.current.narrationEnabled).toBe(false));
    const calls = mocks.fetch.mock.calls.length;
    await act(() => hook.result.current.start());
    expect(mocks.fetch).toHaveBeenCalledTimes(calls);
    hook.unmount();
  });
  it("claims retry ownership before the response and retains completed snapshot ownership", async () => {
    let resolve!: (response: Response) => void;
    mocks.fetch.mockImplementation((url: string) => url.endsWith("/retry") ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(json({ ok: true, job: recapFixture({ status: "partial" }) })));
    const hook = renderHook(() => useVideoRecap(inputs));
    await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    expect(hook.result.current.active).toBe(false); expect(hook.result.current.ownsUploadedAnalysis).toBe(true);
    act(() => hook.result.current.resumeGuidance()); expect(hook.result.current.ownsUploadedAnalysis).toBe(false);
    let retry!: Promise<void>; act(() => { retry = hook.result.current.retry(); });
    expect(hook.result.current.active).toBe(true); expect(hook.result.current.actionBusy).toBe("retry");
    expect(hook.result.current.ownsUploadedAnalysis).toBe(true);
    await act(async () => { resolve(json({ ok: true, job: recapFixture({ id: "retry-B" }) })); await retry; });
    expect(hook.result.current.active).toBe(false); expect(hook.result.current.ownsUploadedAnalysis).toBe(true);
    hook.unmount();
  });
  it("preserves an ended same-source clock through instruction edits for the next recap", async () => {
    let job: ReturnType<typeof recapFixture> | null = recapFixture();
    mocks.fetch.mockImplementation(async () => json({ ok: true, job }));
    const hook = renderHook(props => useVideoRecap(props), { initialProps: inputs });
    await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    act(() => { hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 6, playing: false, ended: true }); hook.result.current.setOpen(false); });
    job = null; hook.rerender({ ...inputs, definitionKey: "edited-reference" });
    await waitFor(() => expect(hook.result.current.job).toBeNull());
    expect(hook.result.current.ownsUploadedAnalysis).toBe(false);
    job = recapFixture({ id: "new-definition-job", status: "analyzing", summary: null });
    await act(() => hook.result.current.refresh());
    expect(hook.result.current.open).toBe(false); expect(hook.result.current.awaitingSummary).toBe(true);
    job = recapFixture({ id: "new-definition-job" }); await act(() => hook.result.current.refresh());
    expect(hook.result.current.open).toBe(true); hook.unmount();
  });
  it("resumes guidance explicitly while retaining the pinned download across closing and reopening", async () => {
    const original = recapFixture();
    mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => url.includes("/plan?") ? json({ ok: true, plan }) : url.endsWith("report.json") ? json(original) : init?.method === "POST" ? json({ ok: true, job: recapFixture({ id: "new-job", status: "queued", summary: null }) }) : json({ ok: true, job: original }));
    const hook = renderHook(() => useVideoRecap(inputs)); await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    act(() => { hook.result.current.setNarrationEnabled(true); hook.result.current.setOpen(false); hook.result.current.setOpen(true); });
    expect(hook.result.current.ownsUploadedAnalysis).toBe(true);
    act(() => hook.result.current.resumeGuidance());
    expect(hook.result.current.ownsUploadedAnalysis).toBe(false); expect(hook.result.current.guidanceResumed).toBe(true);
    expect(hook.result.current.narrationEnabled).toBe(false); expect(hook.result.current.job?.id).toBe(original.id);
    act(() => { hook.result.current.setOpen(false); hook.result.current.openRecap(); });
    await waitFor(() => expect(hook.result.current.plan).not.toBeNull());
    expect(hook.result.current.ownsUploadedAnalysis).toBe(false);
    await act(() => hook.result.current.download()); expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls.some(call => call[0].endsWith(`/jobs/${original.id}/report.json`))).toBe(true);
    await act(() => hook.result.current.start());
    expect(hook.result.current.ownsUploadedAnalysis).toBe(true); expect(hook.result.current.guidanceResumed).toBe(false);
    expect(hook.result.current.job?.id).toBe("new-job"); hook.unmount();
  });
  it("accepts a valid retained JSON larger than 16 MiB within the backend 64 MiB cap", async () => {
    const job = recapFixture(), bytes = JSON.stringify(job) + " ".repeat(17 * 1024 * 1024);
    mocks.fetch.mockImplementation(async (url: string) => {
      if (!url.endsWith("report.json")) return json({ ok: true, job });
      const response = json(job); response.blob = async () => { const file = new Blob([bytes], { type: "application/json" }); Object.defineProperty(file, "text", { value: async () => bytes }); return file; }; return response;
    });
    const hook = renderHook(() => useVideoRecap(inputs)); await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    await act(() => hook.result.current.download());
    expect(mocks.download).toHaveBeenCalledOnce(); expect(hook.result.current.error).toBe(""); hook.unmount();
  });
  it("keeps the recap and opt-in across a native seek's transient readiness reset", async () => {
    const job = recapFixture({ source: { ...recapFixture().source, duration_s: 18 } });
    mocks.fetch.mockResolvedValue(json({ ok: true, job }));
    const hook = renderHook(props => useVideoRecap(props), { initialProps: inputs });
    await waitFor(() => expect(hook.result.current.job).not.toBeNull());
    act(() => hook.result.current.setNarrationEnabled(true));
    act(() => hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 5.4, playing: false, seeking: true }));
    hook.rerender({ ...inputs, sourceReady: false });
    expect(hook.result.current.job?.id).toBe(job.id); expect(hook.result.current.narrationEnabled).toBe(true);
    expect(mocks.speak).not.toHaveBeenCalled();
    hook.rerender(inputs);
    act(() => hook.result.current.notifyPlayback({ sourceId: "source-A", timeS: 6.2, playing: true }));
    expect(mocks.speak).toHaveBeenCalledOnce(); expect(mocks.speak.mock.calls[0][2].isCurrent()).toBe(true);
    hook.unmount();
  });
});
