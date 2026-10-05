import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore } from "../src/domain/session.js";
import { structuredHandoff } from "../src/domain/review.js";
import { createPdfScheduler } from "../src/media/reportScheduling.js";

class FakeWorker extends EventEmitter {
  terminate = vi.fn(async () => 0);
  complete() { const buffer = Buffer.from("%PDF-fixture"); this.emit("message", { ok: true, bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) }); }
}
function sample() { return structuredHandoff(new SessionStore().get("report-scheduling-fixture")); }
function harness(timeoutMs = 1000) {
  const workers: FakeWorker[] = [], snapshots: ReturnType<typeof sample>[] = [];
  const scheduler = createPdfScheduler({ timeoutMs, workerFactory: data => { snapshots.push(data); const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; } });
  return { workers, snapshots, scheduler };
}
afterEach(() => vi.useRealTimers());

describe("bounded PDF worker scheduling", () => {
  it("admits one worker plus two queued snapshots and rejects extra requests immediately", async () => {
    const { workers, snapshots, scheduler } = harness();
    const first = scheduler.render(sample()), queued = sample(), second = scheduler.render(queued), third = scheduler.render(sample());
    queued.reference.title = "Changed after admission";
    expect(workers).toHaveLength(1);
    await expect(scheduler.render(sample())).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining("busy") });
    workers[0].complete(); await expect(first).resolves.toEqual(Buffer.from("%PDF-fixture"));
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers).toHaveLength(2); expect(snapshots[1].reference.title).not.toBe("Changed after admission");
    workers[1].complete(); await second; workers[2].complete(); await third;
    expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
  it("releases worker memory before resolving and admitting the next report", async () => {
    const { workers, scheduler } = harness(); const first = scheduler.render(sample()), second = scheduler.render(sample());
    let release!: () => void; workers[0].terminate.mockImplementation(() => new Promise(resolve => { release = () => resolve(0); }));
    workers[0].complete(); await Promise.resolve(); expect(workers).toHaveLength(1);
    release(); await first; expect(workers).toHaveLength(2); workers[1].complete(); await second;
  });
  it("recovers after worker errors without retrying or duplicating a snapshot", async () => {
    const { workers, scheduler } = harness(); const first = scheduler.render(sample()), second = scheduler.render(sample());
    const rejected = expect(first).rejects.toMatchObject({ statusCode: 503 }); workers[0].emit("error", new Error("Memory pressure")); await rejected;
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers).toHaveLength(2); workers[1].complete(); await second;
  });
  it("expires both stalled active jobs and queued jobs without leaving a worker behind", async () => {
    vi.useFakeTimers(); const { workers, scheduler } = harness(30);
    const first = scheduler.render(sample()), second = scheduler.render(sample());
    const assertions = Promise.all([expect(first).rejects.toMatchObject({ statusCode: 503 }), expect(second).rejects.toMatchObject({ statusCode: 503 })]);
    await vi.advanceTimersByTimeAsync(30); await assertions; expect(workers[0].terminate).toHaveBeenCalledOnce();
    const next = scheduler.render(sample()); workers.at(-1)!.complete(); await next;
  });
  it("rejects corrupt output and can render the next request normally", async () => {
    const { workers, scheduler } = harness(); const first = scheduler.render(sample());
    const rejected = expect(first).rejects.toMatchObject({ statusCode: 503 }); workers[0].emit("message", { ok: true, bytes: new ArrayBuffer(1) }); await rejected;
    const second = scheduler.render(sample()); workers[1].complete(); await second;
  });
  it("removes aborted queued snapshots without allocating a worker or occupying admission slots", async () => {
    const { workers, scheduler } = harness(), controller = new AbortController();
    const first = scheduler.render(sample()), queued = scheduler.render(sample(), controller.signal);
    const rejected = expect(queued).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
    expect(workers).toHaveLength(1); const next = scheduler.render(sample());
    workers[0].complete(); await first; expect(workers).toHaveLength(2); workers[1].complete(); await next;
    await expect(scheduler.render(sample(), controller.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(workers).toHaveLength(2);
  });
  it("terminates aborted active work before running the next queued report", async () => {
    const { workers, scheduler } = harness(), controller = new AbortController();
    const first = scheduler.render(sample(), controller.signal), second = scheduler.render(sample());
    let release!: () => void; workers[0].terminate.mockImplementation(() => new Promise(resolve => { release = () => resolve(0); }));
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" }); controller.abort();
    expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers).toHaveLength(1);
    release(); await rejected; expect(workers).toHaveLength(2); workers[1].complete(); await second;
  });
  it("propagates only the allowlisted font error and keeps its HTML fallback message actionable", async () => {
    const { workers, scheduler } = harness(); const first = scheduler.render(sample());
    const rejected = expect(first).rejects.toMatchObject({ statusCode: 422, code: "unsupported_report_characters", message: expect.stringContaining("offline HTML report") });
    workers[0].emit("message", { ok: false, code: "unsupported_report_characters", message: "private user text" }); await rejected;
    const next = scheduler.render(sample()); workers[1].complete(); await next;
  });
  it("does not expose arbitrary worker errors or user text", async () => {
    const { workers, scheduler } = harness(); const first = scheduler.render(sample());
    const rejected = expect(first).rejects.toMatchObject({ statusCode: 503, message: "Unable to prepare the PDF. Retry or download the HTML report." });
    workers[0].emit("message", { ok: false, code: "untrusted", message: "private user text" }); await rejected;
  });
});
