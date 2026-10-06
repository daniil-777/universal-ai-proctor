import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SessionStore } from "../src/domain/session.js";
import { parseDocument } from "../src/domain/guidance.js";
import { appendReviewEvent, structuredHandoff, syncReview } from "../src/domain/review.js";
import { renderAnalysisHtml, renderAnalysisPdf } from "../src/media/analysisReport.js";
import { fixtureDocument, texturedFrame } from "./fixtures.js";
import { reportOverview } from "../src/media/reportOverview.js";
import { guardianReportFindings } from "../src/media/guardianFindings.js";

async function example() {
  const session = new SessionStore().get("analysis-report-fixture");
  session.sourceId = "source-one"; session.sourceKind = "video"; session.sourceName = "Inspection video";
  session.text = fixtureDocument; session.filename = "inspection.txt"; session.workflow = parseDocument("inspection.txt", fixtureDocument).workflow;
  session.workflow.steps[0].confirmation = "manual"; session.workflow.steps[0].complete = true;
  session.workflow.steps[0].criteria[0].evidence = "Operator confirmed: Größe geprüft. Проверено. Ελληνικά.";
  const review = syncReview(session); review.job.operator = "Zoë <Engineer>";
  appendReviewEvent(review, { id: "bookmark", source_id: session.sourceId, reference_key: review.reference_key, kind: "bookmark", provenance: "operator", occurred_at: 1760000000000, video_time_s: 7.5, summary: "<script>alert('bad')</script>", concern: "", guidance: "Check <the> frame & compare", status: "ok", step_ids: [], thumbnail_b64: `data:image/jpeg;base64,${await texturedFrame()}` });
  return structuredHandoff(session);
}

function syncUnresolved(data: Awaited<ReturnType<typeof example>>) {
  data.unresolved_criteria = data.progress.flatMap(step => step.criteria.filter(criterion => criterion.status !== "met")
    .map(criterion => ({ step_id: step.id, step_name: step.name, key: criterion.key, label: criterion.label, status: criterion.status })));
}

describe("shareable analysis reports", () => {
  it("exports the unchanged default surgical reference with arrows and checkmarks", async () => {
    const session = new SessionStore().get("default-surgical-pdf");
    session.sourceId = "surgical-video"; session.sourceKind = "video"; session.sourceName = "Default surgical video";
    session.filename = "Cholecystectomy.txt";
    session.text = readFileSync(new URL("../../guidance-library/Cholecystectomy.txt", import.meta.url), "utf8");
    session.workflow = parseDocument(session.filename, session.text).workflow;
    const data = structuredHandoff(session);
    data.operator_goals = "Follow → inspect → record. ✔ Keep uncertain steps unconfirmed.";
    expect(data.progress).toHaveLength(6);
    const pdf = await renderAnalysisPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("/FontFile2");
    expect(renderAnalysisHtml(data)).toContain("✔ Keep uncertain steps unconfirmed.");
  });
  it("escapes all operator content in a standalone responsive document", async () => {
    const data = await example(), html = renderAnalysisHtml(data);
    expect(html).toContain("&lt;script&gt;alert(&#39;bad&#39;)&lt;/script&gt;");
    expect(html).toContain("Zoë &lt;Engineer&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain('name="viewport"'); expect(html).toContain("@media(max-width:650px)");
    expect(html).not.toMatch(/(?:src|href)=["']https?:/); expect(html).toContain("default-src 'none'");
    expect(html).toContain("Manually confirmed"); expect(html).toContain("Operator record");
    expect(html).toContain("not a continuous assessment");
  });
  it("rejects active or oversized evidence image URLs even in forged handoff data", async () => {
    const data = await example(); data.evidence[0].thumbnail_b64 = 'data:image/svg+xml,<svg onload="alert(1)"/>';
    expect(renderAnalysisHtml(data)).not.toContain("onload");
    data.evidence[0].thumbnail_b64 = "https://example.com/tracking.jpg";
    expect(renderAnalysisHtml(data)).not.toContain("tracking.jpg");
  });
  it("builds a real portable PDF with local embedded fonts and evidence", async () => {
    const buffer = await renderAnalysisPdf(await example());
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(10_000); expect(buffer.length).toBeLessThan(2_000_000);
    expect(buffer.toString("latin1")).toContain("/FontFile2");
    expect(buffer.subarray(-8).toString()).toContain("%%EOF");
  });
  it("preserves a large workflow and long unbroken notes without losing the last criterion", async () => {
    const data = await example();
    const template = data.progress[0];
    data.progress = Array.from({ length: 35 }, (_, index) => ({ ...template, id: `S${index}`, name: `Step ${index}`, criteria: [{ ...template.criteria[0], label: `Criterion-${index}`, evidence: index === 34 ? "LAST_CRITERION_" + "x".repeat(1400) : template.criteria[0].evidence }] }));
    syncUnresolved(data);
    expect(renderAnalysisHtml(data)).toContain("LAST_CRITERION_");
    const buffer = await renderAnalysisPdf(data); expect(buffer.length).toBeGreaterThan(20_000);
    expect(buffer.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(4);
  });
  it("keeps main-thread timers responsive while rendering 3000 criteria in a real worker", async () => {
    const data = await example(), template = data.progress[0];
    data.progress = Array.from({ length: 100 }, (_, index) => ({ ...template, id: `S${index}`, name: `Stress step ${index}`, criteria: Array.from({ length: 30 }, (_, criterion) => ({ ...template.criteria[0], label: `Criterion ${index}.${criterion}: ${"Inspect the component and record the visible result. ".repeat(3)}`, evidence: "Check the measurement against the approved reference. ".repeat(4) })) }));
    syncUnresolved(data);
    const started = performance.now();
    const timer = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - started), 10));
    const rendering = renderAnalysisPdf(data);
    const delay = await timer;
    const pdf = await rendering;
    expect(delay).toBeLessThan(300);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(100);
  }, 15000);
  it.each(["工序检查", "مرحلة"])("rejects unsupported printed glyphs (%s) with an actionable HTML fallback", async label => {
    const data = await example(); data.progress[0].criteria[0].label = label;
    await expect(renderAnalysisPdf(data)).rejects.toMatchObject({ statusCode: 422, code: "unsupported_report_characters", message: expect.stringContaining("offline HTML report") });
  });
  it("preserves Chinese and Arabic text in the offline HTML report", async () => {
    const data = await example(); data.progress[0].name = "工序检查"; data.operator_goals = "مرحلة";
    const html = renderAnalysisHtml(data); expect(html).toContain("工序检查"); expect(html).toContain("مرحلة");
  });
  it("checks printed text instead of raw metadata and permits line controls", async () => {
    const data = await example(); data.progress[0].id = "工序检查";
    data.operator_goals = "Größe geprüft.\n\tПроверено.\r\n Ελληνικά.";
    const pdf = await renderAnalysisPdf(data); expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("summarizes real completion and verification counts without inventing a quality score", async () => {
    const data = await example(), html = renderAnalysisHtml(data);
    expect(html).toContain("Executive summary"); expect(html).toContain("1 of 2 steps are complete at this snapshot.");
    expect(html).toContain("1 manually confirmed completion(s)"); expect(html).toContain("0 AI-confirmed completion(s)");
    expect(html).toContain(`${data.unresolved_criteria.length} criteria need review`);
    expect(html).not.toContain("Every step."); expect(html).toContain("not an accuracy or quality score");
  });
  it("retains decision notes, source identity and omissions in the editorial composition", async () => {
    const data = await example();
    data.exception_history = [{ id: "issue", title: "Check measurement", description: "Keep the criterion unverified", reference_key: data.reference.reference_key, provenance: "operator", status: "acknowledged", created_at: 1760000000000, updated_at: 1760000000001, old_reference: true, history_omitted: 4, history: [{ status: "open", at: 1760000000000, operator: "Alex", note: "Request instrument record" }, { status: "acknowledged", at: 1760000000001, operator: "Jamie", note: "Waiting for measurement" }] }];
    const html = renderAnalysisHtml(data);
    for (const required of ["Request instrument record", "Waiting for measurement", "Alex", "Jamie", "Earlier reference", "4 older decision(s) omitted", data.source.id, data.reference.reference_key]) expect(html).toContain(required);
    expect(html).toContain("Retained 1 events and 1 thumbnails");
  });
  it("orders review priorities by recorded status and counts every provenance exactly once", async () => {
    const data = await example(), criterion = data.unresolved_criteria[0], event = data.evidence[0];
    data.unresolved_criteria = [{ ...criterion, label: "Unknown item", status: "unknown" }, { ...criterion, label: "Partial item", status: "partial" }, { ...criterion, label: "Not met item", status: "not_met" }];
    data.evidence = [{ ...event, provenance: "ai" }, { ...event, provenance: "operator" }, { ...event, provenance: "system" }, { ...event, provenance: "ai", simulated: true }];
    const before = JSON.stringify(data), overview = reportOverview(data);
    expect(overview.priorities.find(item => item.kind === "Criterion review")).toMatchObject({ title: "Not met item", count: 3, target: "workflow" });
    expect(overview.evidenceGroups.map(item => item.count)).toEqual([1, 1, 1, 1]);
    expect(overview.criteriaGroups.reduce((sum, item) => sum + item.count, 0)).toBe(data.progress.flatMap(step => step.criteria).length);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("exports actions, instruments, principles and extraction notes with escaped content", async () => {
    const data = await example(); data.progress[0].description = "Description record"; data.progress[0].actions = ["Action <one>"]; data.progress[0].expected_instruments = ["Gauge & ruler"];
    data.reference.principles = ["Keep <reference> available"]; data.reference.warnings = ["Workflow needs operator review"];
    const html = renderAnalysisHtml(data);
    for (const item of ["Description record", "Action &lt;one&gt;", "Gauge &amp; ruler", "Keep &lt;reference&gt; available", "Workflow needs operator review", "Reference scope", 'href="#workflow"']) expect(html).toContain(item);
    expect((await renderAnalysisPdf(data)).subarray(0, 5).toString()).toBe("%PDF-");
    data.progress[0].actions = ["工序检查"];
    await expect(renderAnalysisPdf(data)).rejects.toMatchObject({ statusCode: 422, code: "unsupported_report_characters" });
  });
  it("shows unavailable data truthfully and keeps a long workflow title in full", async () => {
    const data = await example(); data.progress = []; data.unresolved_criteria = []; data.operator_checks = []; data.evidence = []; data.open_exceptions = [];
    data.reference.filename = ""; data.reference.workflow_source = "none";
    data.reference.title = "Very long workflow title ".repeat(90) + "FULL_TITLE_FINAL_MARKER";
    const html = renderAnalysisHtml(data);
    expect(html).toContain("No workflow"); expect(html).toContain("No checks"); expect(html).not.toContain("0/0");
    expect(html).toContain("No follow-up items are listed"); expect(html).toContain("FULL_TITLE_FINAL_MARKER");
    expect(html).toContain("No guidance document - workflow not extracted"); expect(html).not.toContain("inferred workflow");
    const pdf = await renderAnalysisPdf(data); expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(3);
    expect(pdf.toString("latin1")).toContain("/Outlines");
  });
  it("includes a static Guardian concern index with exact windows and linked review decisions", async () => {
    const data = await example(), event = { ...data.evidence[0], id: "guardian-one", kind: "observation" as const, provenance: "ai" as const, status: "alert" as const, video_time_s: 8, concern: "Measured value not visible", old_reference: true };
    data.source.duration_s = 20; data.evidence = [event, { ...event, id: "demo", simulated: true }, { ...event, id: "overview", observation_scope: "overview" }, { ...event, id: "other-source", source_id: "earlier-video" }];
    data.exception_history = [{ id: "decision", event_id: event.id, title: event.concern, description: event.concern, reference_key: event.reference_key, provenance: "operator", status: "acknowledged", created_at: 1, updated_at: 2, old_reference: true, history: [{ status: "acknowledged", note: "Waiting for the instrument record", at: 2, operator: "Alex" }] }];
    const index = guardianReportFindings(data); expect(index).toHaveLength(1); expect(index[0].window).toEqual({ start_s: 2, end_s: 11 }); expect(index[0].decisions[0].status).toBe("acknowledged");
    const html = renderAnalysisHtml(data); expect(html).toContain("Guardian findings <span>1 retained"); expect(html).toContain("Suggested video window 00:02 - 00:11"); expect(html).toContain("Waiting for the instrument record"); expect(html).toContain("Earlier reference"); expect(html).not.toContain("/api/review/incidents/");
    data.source.kind = "camera"; expect(guardianReportFindings(data)[0].window).toBeNull(); expect(renderAnalysisHtml(data)).toContain("Recorded sample only - no playable video window");
  });

  it("connects exact issue/evidence/workflow records and keeps earlier instructions separate", async () => {
    const data = await example(), current = { ...data.evidence[0], step_ids: [data.progress[0].id] };
    data.source.duration_s = 60;
    data.evidence = [current, { ...current, id: "old-record", reference_key: "earlier-reference", old_reference: false }];
    data.exception_history = [
      { id: "linked", event_id: current.id, title: "Review this exact record", description: "Recorded concern", reference_key: data.reference.reference_key, provenance: "operator", status: "open", created_at: 1, updated_at: 1, history: [], old_reference: false },
      { id: "orphan", event_id: "not-retained", title: "Missing retained record", description: "Keep original decision", reference_key: data.reference.reference_key, provenance: "operator", status: "open", created_at: 1, updated_at: 1, history: [], old_reference: false },
    ];
    data.open_exceptions = data.exception_history;
    const before = JSON.stringify(data), html = renderAnalysisHtml(data);
    expect(html).toContain('href="#evidence-E01"'); expect(html).toContain('id="evidence-E01"');
    expect(html).toContain('href="#workflow-step-1"'); expect(html).toContain('id="workflow-step-1"');
    expect(html).toContain("Linked evidence is not retained in this snapshot.");
    const oldCard = html.match(/<article class="evidence[^>]*id="evidence-E02">([\s\S]*?)<\/article>/)![1];
    expect(oldCard).toContain("Earlier instructions; recorded step references are not mapped to the current workflow.");
    expect(oldCard).not.toContain('href="#workflow-step-');
    expect(html).toContain("01:00 / video duration");
    expect(html).toContain("Steps needing criterion review");
    const pdf = await renderAnalysisPdf(data), bytes = pdf.toString("latin1");
    expect(bytes).toContain("/GoTo"); expect(bytes).toContain("(evidence-E01)"); expect(bytes).toContain("(workflow-step-1)");
    expect(JSON.stringify(data)).toBe(before);
  });

  it("excludes other-source and out-of-range records from summary scope without discarding their detail", async () => {
    const data = await example(), event = data.evidence[0]; data.source.duration_s = 20;
    data.evidence = [{ ...event, id: "current", summary: "CURRENT_RECORD" },
      { ...event, id: "outside", video_time_s: 21, summary: "OUTSIDE_DURATION_RETAINED" },
      { ...event, id: "other", source_id: "another-source", summary: "OTHER_SOURCE_RETAINED" }];
    const html = renderAnalysisHtml(data);
    expect(html).toContain("2 retained records for this source; 1 timestamped moments");
    expect(html).toContain("1 record(s) from other sources are excluded from these counts and the timeline; they remain in the full evidence section.");
    expect(html).toContain("Timeline excludes 1 out-of-range and 0 invalid timestamp record(s)");
    expect(html).toContain("OUTSIDE_DURATION_RETAINED"); expect(html).toContain("OTHER_SOURCE_RETAINED");
    expect(html).not.toContain("Gaps are unobserved");
    expect(reportOverview(data).evidenceGroups.reduce((sum, group) => sum + group.count, 0)).toBe(2);
  });

  it("shows the entire known-duration axis even when no moment is retained", async () => {
    const data = await example(); data.evidence = []; data.source.duration_s = 20;
    const html = renderAnalysisHtml(data);
    expect(html).toContain('class="moment-lane"'); expect(html).toContain("00:20 / video duration");
    expect(html).toContain("No real moments have been retained for this source.");
    expect(html).toContain("0 retained source-scoped moments on the timeline from 00:00 to 00:20");
    expect((await renderAnalysisPdf(data)).subarray(0, 5).toString()).toBe("%PDF-");
    data.source.duration_s = null;
    expect(renderAnalysisHtml(data)).not.toContain('class="moment-lane"');
  });
});

it("exports an honest chronology while excluding demos, overview samples and unrelated sources from the timeline", async () => {
  const data = await example(), event = data.evidence[0];
  data.evidence = [{ ...event, id: "later", video_time_s: 12, status: "watch" }, { ...event, id: "first", video_time_s: 0 },
    { ...event, id: "demo", simulated: true, video_time_s: 5 }, { ...event, id: "overview", observation_scope: "overview", video_time_s: 40 },
    { ...event, id: "other", source_id: "source-other", video_time_s: 70 }];
  const insights = reportOverview(data);
  expect(insights.moments.map(moment => moment.id)).toEqual(["first", "later"]);
  expect(insights.lastMoment).toBe(12);
  expect(insights.timeline.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
  expect(insights.timeline.at(-1)?.status).toBe("watch");
  const html = renderAnalysisHtml(data);
  expect(html).toContain("Evidence in time"); expect(html).toContain("Gaps mean no retained records");
  expect(html).toContain('href="#timeline"');
  expect((await renderAnalysisPdf(data)).subarray(0, 5).toString()).toBe("%PDF-");
});
