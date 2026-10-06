import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "HF_API_KEY", "QWEN_API_KEY", "LOCAL_LLM_MODEL"]) process.env[key] = "";
process.env.MOCK = "1";
const [{ SessionStore }, { seedReportQa }, { renderAnalysisHtml, renderAnalysisPdf }, { texturedFrame }, { reportOverview }] = await Promise.all([
  import("../backend/src/domain/session.js"), import("./report-qa-data.mjs"),
  import("../backend/src/media/analysisReport.js"), import("../backend/tests/fixtures.js"), import("../backend/src/media/reportOverview.js"),
]);
const output = process.env.REPORT_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "cueveris-report-exports-"));
fs.mkdirSync(output, { recursive: true });
const store = new SessionStore();
const results: Record<string, unknown>[] = [];
const selected = new Set(process.argv.filter(argument => argument.startsWith("--case=")).map(argument => argument.slice(7)));
const data = (mode = "mixed") => seedReportQa(store.get(`export-qa-${mode}`), mode);
const required = (text: string, items: string[]) => {
  const compact = text.replace(/\s/g, "");
  for (const item of items) assert.ok(compact.includes(item.replace(/\s/g, "")), `Missing extracted report text: ${item}`);
};
async function check(name: string, handoff: ReturnType<typeof data>, sentinels: string[], images = false) {
  if (selected.size && !selected.has(name)) return;
  const before = JSON.stringify(handoff);
  const html = renderAnalysisHtml(handoff);
  assert.ok(!/<(?:script|iframe)\b/i.test(html), "Offline report includes active content");
  assert.ok(!/(?:src|href)=["']https?:/i.test(html), "Offline report includes an external resource");
  const targets = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
  for (const link of html.matchAll(/\bhref=["']#([^"']+)["']/g)) assert.ok(targets.has(link[1]), `Offline report link has no target: ${link[1]}`);
  required(html, sentinels);
  const htmlFile = path.join(output, `${name}.html`);
  fs.writeFileSync(htmlFile, html);
  const started = performance.now();
  const pdf = await renderAnalysisPdf(handoff);
  const pdfFile = path.join(output, `${name}.pdf`);
  fs.writeFileSync(pdfFile, pdf);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const textFile = path.join(output, `${name}.txt`);
  execFileSync("pdftotext", ["-layout", pdfFile, textFile]);
  const text = fs.readFileSync(textFile, "utf8");
  required(text, sentinels);
  const derived = reportOverview(handoff);
  const timelinePage = text.split("\f").find(page => page.includes("RECORDED MOMENTS"));
  assert.ok(timelinePage, "PDF is missing the recorded moments heading");
  if (derived.moments.length || derived.durationKnown) {
    required(timelinePage, [derived.durationKnown ? "video duration" : "last retained moment"]);
    if (derived.moments.length) required(timelinePage, [`${derived.moments.length} real, source-scoped moments`, "Recorded (teal), watch (ochre), alert (rust)"]);
  }
  if (derived.outOfRangeCount || derived.invalidTimestampCount) required(timelinePage, [`Timeline excludes ${derived.outOfRangeCount} out-of-range and ${derived.invalidTimestampCount} invalid timestamp record(s)`]);
  const info = execFileSync("pdfinfo", [pdfFile], { encoding: "utf8" });
  const destinations = execFileSync("pdfinfo", ["-dests", pdfFile], { encoding: "utf8" });
  for (const reference of derived.evidenceReferences) assert.ok(destinations.includes(`"evidence-${reference.label}"`), `PDF evidence destination missing: ${reference.label}`);
  handoff.progress.forEach((_step, index) => assert.ok(destinations.includes(`"workflow-step-${index + 1}"`), `PDF workflow destination missing: ${index + 1}`));
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  assert.ok(pages > 0, "PDF has no readable pages");
  assert.equal(JSON.stringify(handoff), before, "Rendering mutated its snapshot");
  const timelinePageNumber = text.split("\f").findIndex(page => page.includes("RECORDED MOMENTS")) + 1;
  if (images) for (const page of [...new Set([1, timelinePageNumber, Math.ceil(pages / 2), pages])]) {
    execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "1400", "-png", pdfFile, path.join(output, `${name}-page-${page}`)]);
  }
  results.push({ name, pages, bytes: pdf.length, render_ms: Math.round(performance.now() - started), extracted_text_characters: text.length, sentinels, snapshot_unchanged: true });
}

const mixed = data();
const overview = reportOverview(mixed);
assert.equal(overview.timelineEnd, 60);
assert.equal(overview.lastMoment, 30);
assert.equal(overview.moments.length, 4);
assert.equal(overview.outOfRangeCount, 1);
assert.deepEqual(overview.reviewQueue.map(step => step.stepId), ["S2", "S1", "S3"]);
assert.equal(overview.evidenceReferences.find(item => item.event.id === "current-alignment")?.label, "E02");
await check("mixed-reference", mixed, ["Current alignment issue", "Earlier guidance issue", "Retained issue with missing event", "E01", "E02", "Prepare", "Inspect", "Größe geprüft.", "Проверено.", "Ελληνικά.", "→", "✔"], true);
await check("empty", data("empty"), ["Empty report fixture", "No workflow criteria", "No real moments"], true);
await check("unknown-duration", data("unknown"), ["last retained moment", "outside-source-duration", "not a continuous assessment"]);
await check("long-identity", data("long"), ["FULL_IDENTITY_END_6789", "STEP_NAME_END_6789", "CRITERION_END_6789", "OPERATOR_END_6789", "EVIDENCE_NOTE_END_6789"], true);

// Forged legacy handoffs can contain invalid timestamps or foreign records;
// live review JSON validates timestamps before state is updated.
const adversarial = data();
adversarial.evidence.push(
  { ...adversarial.evidence[0]!, id: "negative-time", video_time_s: -5, summary: "INVALID_TIMESTAMP_RETAINED_DETAIL" },
  { ...adversarial.evidence[0]!, id: "foreign-source", source_id: "other-source", summary: "OTHER_SOURCE_RETAINED_DETAIL" },
);
await check("adversarial-records", adversarial, ["INVALID_TIMESTAMP_RETAINED_DETAIL", "OTHER_SOURCE_RETAINED_DETAIL", "Current alignment issue"], true);

const retained = data();
const photo = `data:image/jpeg;base64,${await texturedFrame()}`;
retained.evidence = Array.from({ length: 150 }, (_, index) => ({ ...retained.evidence[0]!, id: `retained-${index}`, occurred_at: 1760000000000 + index, video_time_s: index / 3, summary: `RETAINED_EVENT_${String(index + 1).padStart(3, "0")}`, thumbnail_b64: index < 24 ? photo : undefined }));
retained.retention.retained_events = 150;
retained.retention.retained_thumbnails = 24;
retained.retention.retained_thumbnail_bytes = Buffer.byteLength(photo) * 24;
retained.exception_history[0]!.event_id = retained.evidence[149]!.id;
retained.open_exceptions = retained.exception_history.filter(issue => issue.status !== "resolved");
await check("retention-limit", retained, ["RETAINED_EVENT_001", "RETAINED_EVENT_150", "E150", "Current alignment issue"], true);

const stress = data();
const template = stress.progress[1]!;
stress.progress = Array.from({ length: 100 }, (_, index) => ({ ...template, id: `S${index + 1}`, name: `Stress step ${index + 1}`, criteria: Array.from({ length: 30 }, (_, criterion) => ({ ...template.criteria[0]!, key: `S${index + 1}C${criterion + 1}`, label: `Criterion ${index + 1}.${criterion + 1}: ${"Inspect the component and retain uncertainty. ".repeat(3)}`, evidence: index === 99 && criterion === 29 ? `FINAL_CRITERION_SENTINEL_100_30_${"x".repeat(1400)}_END` : "Recorded fixture evidence. ".repeat(5) })) }));
stress.unresolved_criteria = stress.progress.flatMap(step => step.criteria.filter(item => item.status !== "met").map(item => ({ step_id: step.id, step_name: step.name, key: item.key, label: item.label, status: item.status })));
await check("100-steps-3000-criteria", stress, ["Stress step 100", "Criterion 100.30", "FINAL_CRITERION_SENTINEL_100_30_", "x".repeat(1400) + "_END"], true);

for (const label of ["工序检查", "مرحلة"]) {
  if (selected.size && !selected.has(`unsupported-${label}`)) continue;
  const unsupported = data();
  unsupported.progress[0]!.name = label;
  assert.ok(renderAnalysisHtml(unsupported).includes(label), "HTML lost unsupported PDF glyphs");
  await assert.rejects(renderAnalysisPdf(unsupported), error => {
    const value = error as { code?: string; statusCode?: number; message?: string };
    return value.code === "unsupported_report_characters" && value.statusCode === 422 && !!value.message?.includes("offline HTML report");
  });
  results.push({ name: `unsupported-${label}`, html_preserved: true, actionable_pdf_fallback: true });
}
fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ generated_at: new Date().toISOString(), output, results, provider_calls: 0, visual_comparison: "Inconclusive until rendered page screenshots receive human review" }, null, 2));
console.log(JSON.stringify({ output, cases: results.length, results }, null, 2));
