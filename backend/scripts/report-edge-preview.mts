// Local render fixtures only; no model or account calls. Run report-preview.mts first.
import fs from "node:fs/promises";
import type { StructuredHandoff } from "../src/domain/review.js";
import { renderAnalysisHtml, renderAnalysisPdf } from "../src/media/analysisReport.js";

const base = JSON.parse(await fs.readFile(new URL("../../output/pdf/process-guide-analysis-sample.json", import.meta.url), "utf8")) as StructuredHandoff;
const destination = new URL("../../tmp/pdfs/report-upgrade/", import.meta.url);
await fs.mkdir(destination, { recursive: true });
for (const name of ["long-title", "empty-camera"] as const) {
  const data = structuredClone(base);
  if (name === "long-title") {
    data.reference.title = "Very long workflow identity " .repeat(90) + "FULL_TITLE_FINAL_MARKER";
    data.reference.principles = ["Recorded principle: inspect the working area. PRINCIPLE_FINAL_MARKER"];
    data.reference.warnings = ["Extraction requires operator review. WARNING_FINAL_MARKER"];
    data.progress[0].description = "Recorded description. DESCRIPTION_FINAL_MARKER";
    data.progress[0].actions = ["Record the planned action. ACTION_FINAL_MARKER"];
    data.progress[0].expected_instruments = ["Measurement instrument. INSTRUMENT_FINAL_MARKER"];
  } else {
    data.source = { ...data.source, kind: "camera", name: "Live camera", current_time_s: 0, duration_s: null };
    data.reference.filename = "";
    data.reference.workflow_source = "none";
    data.reference.principles = [];
    data.reference.warnings = [];
    data.reference.title = "Camera guidance before workflow extraction";
    data.progress = []; data.unresolved_criteria = []; data.operator_checks = [];
    data.evidence = []; data.open_exceptions = []; data.exception_history = [];
    data.retention.retained_events = 0; data.retention.retained_thumbnails = 0;
  }
  const started = performance.now(), pdf = await renderAnalysisPdf(data);
  await fs.writeFile(new URL(`${name}.pdf`, destination), pdf);
  await fs.writeFile(new URL(`${name}.html`, destination), renderAnalysisHtml(data));
  console.log(JSON.stringify({ fixture: name, bytes: pdf.length, render_ms: Math.round(performance.now() - started), pages: pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length }));
}
