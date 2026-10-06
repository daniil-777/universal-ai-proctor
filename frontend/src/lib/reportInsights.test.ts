import { describe, expect, it } from "vitest";
import type { ReviewEvent, ReviewResponse } from "./reviewTypes";
import type { ChatMessage, Stage } from "./types";
import { completedConversation, currentReportReference, formatReportTime, reportCounts, reportEventTime, reportMoments, reportReferences, reportReviewQueue, reportScope, reportTimelineData } from "./reportInsights";

const event = (id: string, time: number, patch: Partial<ReviewEvent> = {}): ReviewEvent => ({
  id, source_id: "video-A", reference_key: "guide-A", kind: "observation", provenance: "ai",
  occurred_at: 1000, video_time_s: time, summary: id, guidance: "", concern: "",
  status: "ok", step_ids: [], old_reference: false, ...patch,
});
const review = (events: ReviewEvent[]) => ({ source_id: "video-A", events }) as ReviewResponse;
const message = (role: ChatMessage["role"], text: string, ts = 0, streaming = false): ChatMessage =>
  ({ id: `${role}-${ts}`, role, text, ts, streaming });

describe("report insights retain the meaning of recorded evidence", () => {
  it("keeps real moments chronological without mutating records or including other sources, demos, overviews or invalid times", () => {
    const records = [event("late", 20), event("first", 0), event("earlier-guide", 8, { old_reference: true }),
      event("demo", 2, { simulated: true }), event("overview", 3, { observation_scope: "overview" }),
      event("other", 4, { source_id: "video-B" }), event("bad", NaN), event("negative", -1)];
    const order = records.map(item => item.id);
    expect(reportMoments(review(records)).map(item => item.id)).toEqual(["first", "earlier-guide", "late"]);
    expect(records.map(item => item.id)).toEqual(order);
    expect(reportMoments(null)).toEqual([]);
  });
  it("counts each completion and provenance once and keeps unresolved criteria separate from completion", () => {
    const stages = [
      { complete: true, confirmation: "manual", criteria: [{ status: "unknown" }] },
      { complete: true, confirmation: "AI", criteria: [{ status: "met" }, { status: "partial" }] },
      { complete: false, criteria: [{ status: "not_met" }] },
    ] as Stage[];
    const counts = reportCounts(stages, review([event("ai", 0), event("operator", 1, { provenance: "operator" }),
      event("system", 2, { provenance: "system" }), event("demo", 3, { simulated: true }),
      event("other", 4, { source_id: "video-B" })]));
    expect(counts.completed).toBe(2);
    expect(counts.criteria).toEqual({ met: 1, partial: 1, not_met: 1, unknown: 1 });
    expect(counts.evidence).toEqual({ ai: 1, operator: 1, system: 1, simulated: 1 });
    expect(counts.evidenceTotal).toBe(4);
  });
  it("pairs only the first completed answer per question, excluding errors, Guardian notices and interrupted questions", () => {
    const chat = [message("assistant", "Welcome"), message("user", "Unanswered"), message("user", "Question", 2),
      message("assistant", "Streaming", 3, true), message("assistant", "Answer"), message("assistant", "Extra"),
      message("user", "Failed", 4), message("assistant", "⚠ Failed"), message("assistant", "Later"),
      message("user", "Guardian", 5), message("assistant", "🛡️ Notice"),
      message("user", "Next", 6), message("assistant", ""), message("assistant", "Next answer")];
    expect(completedConversation(chat)).toEqual([{ q: "Question", a: "Answer", ts: 2 }, { q: "Next", a: "Next answer", ts: 6 }]);
  });
  it("formats zero, long recordings and invalid values consistently", () => {
    expect(formatReportTime(0)).toBe("00:00");
    expect(formatReportTime(3601.9)).toBe("60:01");
    expect(formatReportTime(NaN)).toBe("00:00");
    expect(formatReportTime(-1)).toBe("00:00");
  });
  it("numbers source-scoped records once in recorded-time/id order and classifies exclusive scope without hiding invalid timestamps", () => {
    const records = [event("z", 50, { occurred_at: 2 }), event("a", -1, { occurred_at: 2, reference_key: "older" }),
      event("demo", 3, { occurred_at: 1, simulated: true, observation_scope: "overview", old_reference: true }),
      event("overview", 4, { occurred_at: 3, observation_scope: "overview" }), event("other", 0, { source_id: "other" })];
    const data = { ...review(records), reference_key: "guide-A" };
    expect([...reportReferences(data)].map(([id, reference]) => [id, reference.label])).toEqual([["demo", "E01"], ["a", "E02"], ["z", "E03"], ["overview", "E04"]]);
    expect(reportScope(data)).toEqual({ current: 1, earlier: 1, overview: 1, simulated: 1 });
    expect(currentReportReference(records[1], data)).toBe(false);
    expect(reportEventTime(records[1])).toBe("Timestamp unavailable");
    expect(records.map(record => record.id)).toEqual(["z", "a", "demo", "overview", "other"]);
  });
  it("prioritizes recorded not-met and partial criteria while keeping manual completion and original workflow order intact", () => {
    const stages = [{ id: "unknown", complete: true, confirmation: "manual", criteria: [{ status: "unknown" }] },
      { id: "partial", criteria: [{ status: "partial" }] }, { id: "notmet", criteria: [{ status: "met" }, { status: "not_met" }] },
      { id: "unknown2", criteria: [{ status: "unknown" }] }] as Stage[];
    const queue = reportReviewQueue(stages);
    expect(queue.map(item => item.step.id)).toEqual(["notmet", "partial", "unknown", "unknown2"]);
    expect(queue[2].step.complete).toBe(true);
    expect(queue[2].counts.unknown).toBe(1);
    expect(stages.map(step => step.id)).toEqual(["unknown", "partial", "notmet", "unknown2"]);
  });
  it("keeps a known-duration tail empty and excludes invalid/out-of-range moments without dropping source evidence", () => {
    const data = { ...review([event("zero", 0), event("last", 20), event("outside", 121), event("negative", -1)]), source_duration_s: 120 };
    const timeline = reportTimelineData(data);
    expect(timeline.end).toBe(120);
    expect(timeline.durationKnown).toBe(true);
    expect(timeline.moments.map(item => item.id)).toEqual(["zero", "last"]);
    expect(timeline.outOfRangeCount).toBe(1);
    expect(timeline.invalidTimestampCount).toBe(1);
    expect(data.events).toHaveLength(4);
    expect(reportTimelineData({ ...data, source_duration_s: undefined }).end).toBe(121);
    expect(reportTimelineData({ ...data, source_duration_s: null }).durationKnown).toBe(false);
  });
});
