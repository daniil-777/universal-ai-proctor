import { describe, expect, it } from "vitest";
import { parseReviewPayload } from "./reviewPayload";

const payload = () => ({
  ok: true, source_id: "inspection-source", reference_key: "reference", review_version: 3,
  job: { work_order: "", asset: "", operator: "" }, checks: [], events: [], exceptions: [],
  retention: { events: 150, thumbnails: 24, retained_events: 0, retained_thumbnails: 0,
    dropped_events: 0, dropped_thumbnails: 0, dropped_exceptions: 0 }, notice: "Recorded snapshot",
});

describe("review source duration", () => {
  it("accepts older payloads and unknown duration without fabricating a duration", () => {
    expect(parseReviewPayload(payload()).source_duration_s).toBeUndefined();
    expect(parseReviewPayload({ ...payload(), source_duration_s: null }).source_duration_s).toBeNull();
  });
  it("preserves precise known video duration and leaves the response unchanged", () => {
    const response = { ...payload(), source_duration_s: 120.75 };
    const before = JSON.stringify(response);
    expect(parseReviewPayload(response).source_duration_s).toBe(120.75);
    expect(JSON.stringify(response)).toBe(before);
  });
  it.each([0, -1, NaN, Infinity, "120"])("rejects malformed duration %s before storing review state", duration => {
    expect(() => parseReviewPayload({ ...payload(), source_duration_s: duration }))
      .toThrow("incomplete review records");
  });
});
