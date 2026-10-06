import { describe, expect, it } from "vitest";
import { parseVideoSummaryJob, recapEvidence } from "./videoSummaryTypes";
import { recapFixture } from "./videoSummaryTestFixture";

describe("video recap evidence contract", () => {
  it("keeps genuine provenance and estimated metric support without inventing a score", () => {
    const job = parseVideoSummaryJob(recapFixture());
    expect(job.provenance.simulated).toBe(true); expect(job.metrics[0].status).toBe("estimated");
    expect(recapEvidence(job, "W0001-E01")?.text).toContain("sampled frame");
    expect(recapEvidence(job, "foreign-evidence")).toBeNull();
  });
  it("rejects hallucinated frame and summary references", () => {
    const job = recapFixture(); job.windows[0].events[0].frame_refs = ["foreign-frame"];
    expect(() => parseVideoSummaryJob(job)).toThrow("evidence");
    const other = recapFixture(); other.summary!.key_findings[0].evidence_refs = ["W0001-F01"];
    expect(() => parseVideoSummaryJob(other)).toThrow("finding");
  });
  it("rejects contradictory values, impossible intervals and invalid progress", () => {
    const job = recapFixture(); job.metrics[0].status = "unavailable";
    expect(() => parseVideoSummaryJob(job)).toThrow("metric");
    const range = recapFixture(); range.windows[0].events[0].end_s = 7;
    expect(() => parseVideoSummaryJob(range)).toThrow("interval");
    const progress = recapFixture(); progress.progress.failed_windows = 1;
    expect(() => parseVideoSummaryJob(progress)).toThrow("progress");
  });
  it("does not accept unsupported empty citations or conflicting IDs", () => {
    const job = recapFixture(); job.windows[0].events[0].frame_refs = [];
    expect(() => parseVideoSummaryJob(job)).toThrow("evidence");
    const duplicate = recapFixture(); duplicate.windows[0].sampled_frames[0].id = "W0001";
    expect(() => parseVideoSummaryJob(duplicate)).toThrow("identities");
  });
});
