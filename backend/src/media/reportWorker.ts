import { parentPort, workerData } from "node:worker_threads";
import type { StructuredHandoff } from "../domain/review.js";

try {
  // Node 24 strips this entry's types in dev. tsImport resolves its source .js imports.
  // Compiled deployments execute the JS branch and do not need the dev-only tsx package.
  const renderer = import.meta.url.endsWith(".ts")
    ? await (await import("tsx/esm/api")).tsImport("./analysisPdf.ts", import.meta.url)
    : await import("./analysisPdf.js");
  const pdf: Buffer = await renderer.renderAnalysisPdfDirect(workerData as StructuredHandoff);
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  parentPort?.postMessage({ ok: true, bytes }, [bytes]);
} catch (error) {
  // Only an allowlisted code crosses the worker boundary; no raw exception/document text.
  const unsupported = (error as { code?: unknown })?.code === "unsupported_report_characters";
  parentPort?.postMessage({ ok: false, code: unsupported ? "unsupported_report_characters" : undefined });
}
