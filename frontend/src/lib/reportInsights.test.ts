import { describe, expect, it } from "vitest";
import type { ReviewEvent, ReviewResponse } from "./reviewTypes";
import type { ChatMessage, Stage } from "./types";
import { completedConversation, formatReportTime, reportCounts, reportMoments } from "./reportInsights";

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
});
