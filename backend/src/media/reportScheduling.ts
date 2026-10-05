import { Worker } from "node:worker_threads";
import type { StructuredHandoff } from "../domain/review.js";
import { UNSUPPORTED_REPORT_CHARACTERS, unsupportedReportCharacters } from "./reportErrors.js";

type RenderWorker = Pick<Worker, "on" | "terminate">;
type Task = { data: StructuredHandoff; resolve: (value: Buffer) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; done: boolean; cancel?: (error: Error) => void; signal?: AbortSignal; abortListener?: () => void };
type WorkerResponse = { ok: boolean; bytes?: ArrayBuffer; code?: unknown };
const unavailable = (message: string) => Object.assign(new Error(message), { statusCode: 503 });
const cancelled = () => new DOMException("Report preparation cancelled.", "AbortError");

function makeWorker(data: StructuredHandoff): RenderWorker {
  return new Worker(new URL(import.meta.url.endsWith(".ts") ? "./reportWorker.ts" : "./reportWorker.js", import.meta.url), {
    workerData: data, execArgv: [], name: "process-guide-report",
    resourceLimits: { maxOldGenerationSizeMb: 384, stackSizeMb: 8 },
  });
}

/** One CPU job and at most two waiting snapshots for the entire server process. */
export function createPdfScheduler(options: { workerFactory?: (data: StructuredHandoff) => RenderWorker; timeoutMs?: number; maxQueued?: number } = {}) {
  const factory = options.workerFactory || makeWorker;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxQueued = options.maxQueued ?? 2;
  const queue: Task[] = [];
  let active: Task | undefined;
  const cleanup = (task: Task) => { clearTimeout(task.timer); if (task.signal && task.abortListener) task.signal.removeEventListener("abort", task.abortListener); };
  const cancel = (task: Task, error: Error) => {
    if (task.done) return;
    if (task.cancel) task.cancel(error);
    else {
      task.done = true; cleanup(task);
      const index = queue.indexOf(task); if (index >= 0) queue.splice(index, 1);
      task.reject(error);
    }
  };

  const start = (task: Task) => {
    active = task;
    let worker: RenderWorker | undefined;
    const finish = async (value?: Buffer, error?: Error) => {
      if (task.done) return;
      task.done = true; cleanup(task);
      // Await disposal before admitting another job, releasing its font/page memory.
      if (worker) await worker.terminate().catch(() => {});
      if (value) task.resolve(value); else task.reject(error || unavailable("Unable to prepare the PDF. Retry or download the HTML report."));
      if (active === task) active = undefined;
      const next = queue.shift(); if (next) start(next);
    };
    task.cancel = error => { void finish(undefined, error); };
    try {
      worker = factory(task.data);
      worker.on("message", (message: WorkerResponse) => {
        if (!message.ok && message.code === UNSUPPORTED_REPORT_CHARACTERS) { void finish(undefined, unsupportedReportCharacters()); return; }
        if (!message.ok || !(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength > 30 * 1024 * 1024) { void finish(); return; }
        const pdf = Buffer.from(message.bytes);
        if (pdf.subarray(0, 5).toString() !== "%PDF-") { void finish(); return; }
        void finish(pdf);
      });
      worker.on("error", () => { void finish(); });
      worker.on("exit", () => { if (!task.done) void finish(); });
    } catch { void finish(); }
  };

  return {
    render(data: StructuredHandoff, signal?: AbortSignal): Promise<Buffer> {
      if (signal?.aborted) return Promise.reject(cancelled());
      if (active && queue.length >= maxQueued) return Promise.reject(unavailable("Report service is busy. Wait a moment and retry."));
      return new Promise((resolve, reject) => {
        // Capture queued data now; later caller mutations cannot change this snapshot.
        const snapshot = structuredClone(data);
        const task: Task = { data: snapshot, resolve, reject, done: false, signal, timer: setTimeout(() => {
          cancel(task, unavailable("PDF preparation timed out. Retry or download the HTML report."));
        }, timeoutMs) };
        if (signal) {
          task.abortListener = () => cancel(task, cancelled());
          signal.addEventListener("abort", task.abortListener, { once: true });
          if (signal.aborted) { task.abortListener(); return; }
        }
        if (active) queue.push(task); else start(task);
      });
    },
  };
}

const scheduler = createPdfScheduler();
export const renderPdfInWorker = (data: StructuredHandoff, signal?: AbortSignal) => scheduler.render(data, signal);
