import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/domain/session.js";
import { parseDocument } from "../src/domain/guidance.js";
import { structuredHandoff } from "../src/domain/review.js";
import { reportEvidenceContext, reportOverview } from "../src/media/reportOverview.js";
import { fixtureDocument } from "./fixtures.js";

function fixture() {
  const session = new SessionStore().get("report-derived-fixture");
  session.sourceId = "source"; session.sourceKind = "video";
  session.filename = "guide.txt"; session.text = fixtureDocument;
  session.workflow = parseDocument(session.filename, session.text).workflow;
  return structuredHandoff(session);
}
function event(id: string, time = 2) {
  const data = fixture();
  return { id, source_id: data.source.id, reference_key: data.reference.reference_key,
    kind: "observation" as const, provenance: "ai" as const, occurred_at: 10, video_time_s: time,
    summary: id, concern: "", guidance: "", status: "ok" as const, step_ids: [] as string[],
    old_reference: false, thumbnail_available: false };
}

describe("pure report review derivation", () => {
  it("spans a known source duration, keeps an empty tail and preserves excluded records", () => {
    const data = fixture(); data.source.duration_s = 20;
    data.evidence = [event("first", 2), event("later", 3), event("outside", 21), event("invalid", -1)];
    const before = JSON.stringify(data), overview = reportOverview(data);
    expect(overview).toMatchObject({ timelineEnd: 20, lastMoment: 3, durationKnown: true, outOfRangeCount: 1, invalidTimestampCount: 1 });
    expect(overview.moments.map(item => item.id)).toEqual(["first", "later"]);
    expect(overview.timeline.slice(7).every(bin => bin.count === 0)).toBe(true);
    expect(overview.evidenceReferences).toHaveLength(4);
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])("labels an unavailable duration (%s) and uses retained extent", duration => {
    const data = fixture(); data.source.duration_s = duration; data.evidence = [event("last", 12)];
    expect(reportOverview(data)).toMatchObject({ timelineEnd: 12, lastMoment: 12, durationKnown: false });
    data.source.kind = "camera"; data.source.duration_s = 100;
    expect(reportOverview(data)).toMatchObject({ timelineEnd: 12, durationKnown: false });
  });

  it("bins a short positive video duration without pretending it is a one-second source", () => {
    const data = fixture(); data.source.duration_s = .5; data.evidence = [event("middle", .25), event("end", .5)];
    const overview = reportOverview(data);
    expect(overview.timeline[20].count).toBe(1); expect(overview.timeline[39].count).toBe(1);
  });

  it("assigns snapshot references before filtering and counts source scope exactly once", () => {
    const data = fixture(), current = event("b");
    data.evidence = [current, { ...event("a"), occurred_at: 10 },
      { ...event("earlier"), old_reference: true }, { ...event("mismatch"), reference_key: "previous" },
      { ...event("overview"), old_reference: true, observation_scope: "overview" },
      { ...event("demo"), simulated: true }, { ...event("demo-overview"), simulated: true, observation_scope: "overview" },
      { ...event("other"), source_id: "another-source" }];
    const before = JSON.stringify(data), overview = reportOverview(data);
    expect(overview.scopeGroups.map(group => group.count)).toEqual([2, 2, 1, 2]);
    expect(overview).toMatchObject({ sourceRecords: 7, otherSourceCount: 1 });
    expect(overview.evidenceGroups.reduce((sum, group) => sum + group.count, 0)).toBe(7);
    expect(overview.evidenceReferences[0]).toMatchObject({ label: "E01", event: { id: "a" } });
    const labels = overview.evidenceReferences.map(item => [item.event.id, item.label]);
    expect(reportOverview({ ...data, evidence: data.evidence.slice().reverse() }).evidenceReferences.map(item => [item.event.id, item.label])).toEqual(labels);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("keeps criterion review separate from manual completion and orders recorded statuses", () => {
    const data = fixture(), template = data.progress[0], criterion = template.criteria[0];
    data.progress = [
      { ...template, id: "manual", name: "Manual record", complete: true, confirmation: "manual", criteria: [{ ...criterion, status: "unknown" }] },
      { ...template, id: "partial", name: "Partial record", criteria: [{ ...criterion, status: "partial" }] },
      { ...template, id: "not-met", name: "Not met record", criteria: [{ ...criterion, status: "not_met" }, { ...criterion, status: "unknown" }] },
      { ...template, id: "met", name: "Met record", criteria: [{ ...criterion, status: "met" }] },
    ];
    const queue = reportOverview(data).reviewQueue;
    expect(queue.map(step => step.stepId)).toEqual(["not-met", "partial", "manual"]);
    expect(queue[0]).toMatchObject({ notMet: 1, partial: 0, unknown: 1, total: 2, index: 2 });
    expect(queue[2]).toMatchObject({ complete: true, confirmation: "manual", unknown: 1, total: 1 });
    expect(data.progress[0].complete).toBe(true);
  });

  it("links current-reference steps only and reports absent step references without guessing", () => {
    const data = fixture(), record = { ...event("record"), step_ids: [data.progress[0].id, "missing"] };
    expect(reportEvidenceContext(data, record)).toMatchObject({ earlierReference: false, steps: [{ index: 0, id: data.progress[0].id }], unavailableStepCount: 1 });
    expect(reportEvidenceContext(data, { ...record, old_reference: true }).steps).toEqual([]);
    expect(reportEvidenceContext(data, { ...record, reference_key: "previous" })).toMatchObject({ earlierReference: true, steps: [] });
    expect(reportEvidenceContext(data, { ...record, source_id: "another-source" }).steps).toEqual([]);
  });

  it("returns honest empty data without undefined percentages or fabricated records", () => {
    const data = fixture(); data.progress = []; data.unresolved_criteria = []; data.evidence = [];
    const overview = reportOverview(data);
    expect(overview).toMatchObject({ criteriaTotal: 0, sourceRecords: 0, timelineEnd: 0, durationKnown: false, reviewQueue: [], evidenceReferences: [] });
    expect(overview.timeline.every(bin => bin.count === 0)).toBe(true);
  });
});
