import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { SessionStore, type Session } from "../src/domain/session.js";
import { referenceKey } from "../src/domain/review.js";
import { parseDocument } from "../src/domain/guidance.js";
import { VideoSummaryJobSchema, VideoSummaryStartSchema, type VideoSummaryJob } from "../src/domain/videoSummary.js";
import { VideoSummaryJobs, videoSummaryContextFingerprint } from "../src/media/videoSummaryJobs.js";
import { createVideoSummaryMetricPlan, deriveVideoSummaryMetrics, intervalUnion, videoSummaryDomainCatalog, videoSummarySafeError } from "../src/pipeline/videoSummary.js";
import { config } from "../src/config.js";
import type { Complete, CompletionInput } from "../src/llm/client.js";
import type { VideoFrameSampler } from "../src/pipeline/videoSummaryFrames.js";

let directory: string;
const managers: VideoSummaryJobs[] = [];
beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-summary-tests-")); fs.writeFileSync(path.join(directory, "source.mp4"), "fixture"); });
afterEach(async () => { await Promise.all(managers.splice(0).map(manager => manager.close())); });
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
function session(duration = 18): Session {
  const s = new SessionStore().get(crypto.randomUUID());
  s.sourceId = "video-1"; s.sourceKind = "video"; s.sourceName = "Fixture assembly"; s.videoPath = path.join(directory, "source.mp4");
  s.videoInfo = { duration, fps: 30, width: 640, height: 360 };
  s.filename = "Process.txt"; s.text = "Step 1 — Assemble\nActions: Place the tool\nCriteria: Tool visible";
  Object.assign(s, parseDocument(s.filename, s.text)); return s;
}
function request(s: Session) { return { source_id: s.sourceId, reference_key: referenceKey(s), mode: "detailed" as const }; }
const sample: VideoFrameSampler = async ({ start_s, end_s, count, signal }) => { signal.throwIfAborted(); return Array.from({ length: count }, (_, i) => ({ buffer: Buffer.from("jpeg"), time_s: start_s + (end_s - start_s) * (i + 0.5) / count })); };
function payload(input: CompletionInput): any { return JSON.parse(input.prompt.slice(input.prompt.indexOf("\n") + 1)); }
function stage(input: CompletionInput) { return input.prompt.split("\n")[0]!.split(": ")[1]; }
function windowOutput(input: CompletionInput) {
  const data = payload(input); const first = data.sampled_frames[0]; const last = data.sampled_frames.at(-1);
  const metric = data.metric_catalog.find((metric: any) => metric.event_kinds.includes("action"));
  return { summary: "Fixture: a tool is moved.", narration: "Fixture: the tool moves.", phase: "Assembly", events: [{ kind: "action", label: "Move tool", detail: "Fixture motion", start_s: first.time_s, end_s: last.time_s, frame_refs: [first.id, last.id], transcript_refs: [], metric_ids: metric ? [metric.id] : [], certainty: "estimated", uncertainty: "Motion between sampled images is not established." }], uncertainties: ["Fixture sampled images."], metric_ids: ["retained_events"] };
}
const fixtureComplete: Complete = async input => {
  input.signal?.throwIfAborted(); const data = payload(input);
  if (stage(input) === "domain") return JSON.stringify({ domain: { key: "manufacturing", label: "Manufacturing", basis: "both", rationale: "Fixture image and assembly reference context.", confidence: 0.8, conflict: null }, selected_metric_ids: data.metric_catalog.filter((metric: any) => metric.domain_key === (data.domain_override || "manufacturing")).slice(0, 2).map((metric: any) => metric.id) });
  if (stage(input) === "window") return JSON.stringify(windowOutput(input));
  if (stage(input) === "verification") return JSON.stringify(data.proposed);
  return JSON.stringify({ headline: "Fixture assembly recap", overview: "Retained sampled assembly episodes.", chapters: [{ id: "model-chapter", title: "Assembly", start_s: 0, end_s: data.duration_s, summary: "Tool movement is estimated.", evidence_refs: data.allowed_evidence_refs.slice(0, 2) }], key_findings: [{ text: "Tool movement was retained.", evidence_refs: data.allowed_evidence_refs.slice(0, 1) }], limitations: ["Fixture observations only."] });
};
function manager(complete: Complete = fixtureComplete, options: ConstructorParameters<typeof VideoSummaryJobs>[0] = {}) {
  const value = new VideoSummaryJobs({ complete, sampleFrames: sample, allowMockForTests: true, ...options }); managers.push(value); return value;
}
async function terminal(value: VideoSummaryJobs, s: Session, id: string): Promise<VideoSummaryJob> {
  await vi.waitFor(() => expect(["complete", "partial", "failed", "cancelled", "stale"]).toContain(value.get(s, id).status), { timeout: 3000, interval: 5 });
  return value.get(s, id);
}

describe("whole-video recap evidence integrity", () => {
  it("processes every primary window and derives technical measurements without changing workflow confirmations", async () => {
    const s = session(18.5), before = structuredClone(s.workflow), value = manager(); const initial = value.start(s, request(s));
    const job = await terminal(value, s, initial.id);
    expect(VideoSummaryJobSchema.safeParse(job).success).toBe(true); expect(job.status).toBe("complete");
    expect(job.windows.map(w => [w.start_s, w.end_s])).toEqual([[0, 6], [6, 12], [12, 18], [18, 18.5]]);
    expect(job.progress).toEqual({ total_windows: 4, completed_windows: 4, failed_windows: 0, analyzed_through_s: 18.5, sampled_frames: 36 });
    expect(job.metrics.find(m => m.id === "source_duration")).toMatchObject({ value: 18.5, status: "measured" });
    expect(job.metrics.find(m => m.id === "analyzed_window_coverage")).toMatchObject({ value: 18.5, status: "measured" });
    expect(job.metrics.find(m => m.id === "retained_events")).toMatchObject({ value: 4, status: "estimated" });
    expect(job.metrics[0]).toMatchObject({ id: "manufacturing_assembly", value: 4, status: "estimated" });
    expect(job.metrics[1]).toMatchObject({ id: "manufacturing_inspection", value: null, status: "unavailable" });
    expect(job.metrics.find(m => m.id === "critical_domain_metric")).toMatchObject({ value: null, status: "unavailable" });
    expect(job.summary?.chapters[0]?.summary).toContain("Estimated from sampled evidence");
    expect(job.provenance).toMatchObject({ simulated: true, model_calls: 10, visual_analysis: "sampled_frames" });
    expect(s.workflow).toEqual(before); expect(s.observations).toEqual([]); expect(s.stats.checks).toBe(0);
    job.windows[0]!.summary = "mutated client"; expect(value.get(s, job.id).windows[0]!.summary).not.toBe("mutated client");
  });
  it.each(["foreign frame", "outside time", "empty citations", "foreign metric", "foreign finding metric", "unknown critical tag", "technical metadata tag", "wrong domain metric kind", "malformed number", "extra field", "no uncertainty", "frame outside episode"])("preserves a failed interval after twice rejecting %s", async kind => {
    const s = session(6); let windowCalls = 0;
    const complete: Complete = async input => {
      if (stage(input) !== "window") return fixtureComplete(input);
      windowCalls++; const output = windowOutput(input); const event = output.events[0]!;
      if (kind === "foreign frame") event.frame_refs = ["other-source-F01"];
      if (kind === "outside time") event.end_s = 99;
      if (kind === "empty citations") event.frame_refs = [];
      if (kind === "foreign metric") output.metric_ids = ["overall-quality"];
      if (kind === "foreign finding metric") event.metric_ids = ["other-source-metric"];
      if (kind === "unknown critical tag") event.metric_ids = ["critical_domain_metric"];
      if (kind === "technical metadata tag") event.metric_ids = ["source_duration"];
      if (kind === "wrong domain metric kind") (event as any).kind = "state";
      if (kind === "malformed number") (event as any).start_s = "0";
      if (kind === "extra field") (output as any).quality_score = 100;
      if (kind === "no uncertainty") (event as any).uncertainty = null;
      if (kind === "frame outside episode") event.end_s = event.start_s;
      return JSON.stringify(output);
    };
    const value = manager(complete), job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.status).toBe("failed"); expect(windowCalls).toBe(2); expect(job.windows[0]).toMatchObject({ status: "failed", events: [], sampled_frames: expect.any(Array) }); expect(job.progress.failed_windows).toBe(1); expect(job.summary).toBeNull();
  });
  it("retries malformed window JSON once and conservatively deduplicates identical overlapping episodes without erasing original findings", async () => {
    let calls = 0; const s = session(6);
    const value = manager(async input => {
      if (stage(input) !== "window") return fixtureComplete(input);
      if (++calls === 1) return "{truncated";
      const output = windowOutput(input); output.events.push(structuredClone(output.events[0]!)); return JSON.stringify(output);
    });
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.status).toBe("complete"); expect(calls).toBe(2); expect(job.windows[0]!.events).toHaveLength(2);
    expect(job.metrics.find(metric => metric.id === "retained_events")?.value).toBe(1);
    expect(job.metrics.find(metric => metric.id === "observed_span")?.value).toBeCloseTo(16 / 3);
  });
  it("retains partial evidence and manual retry analyzes only failed windows", async () => {
    const s = session(); const calls = new Map<string, number>(); let fail = true;
    const value = manager(async input => {
      if (stage(input) === "window") { const id = payload(input).window.id; calls.set(id, (calls.get(id) || 0) + 1); if (id === "W0002" && fail) return "{}"; }
      return fixtureComplete(input);
    });
    const initial = await terminal(value, s, value.start(s, request(s)).id);
    expect(initial.status).toBe("partial"); expect(initial.progress).toMatchObject({ completed_windows: 2, failed_windows: 1 });
    expect(initial.metrics.find(m => m.id === "analyzed_window_coverage")?.value).toBe(12);
    const accepted = structuredClone(initial.windows[0]); fail = false; const resumed = value.retry(s, initial.id);
    expect(resumed.id).not.toBe(initial.id);
    const retried = await terminal(value, s, resumed.id);
    expect(retried.status).toBe("complete"); expect(retried.windows[0]).toEqual(accepted);
    expect(value.get(s, initial.id)).toEqual(initial); expect(retried.provenance.model_calls).toBe(3);
    expect([...calls]).toEqual([["W0001", 1], ["W0002", 3], ["W0003", 1]]);
  });
  it("rejects foreign synthesis citations and retains an explicit partial result without fabricated substitute findings", async () => {
    const s = session(6); const value = manager(async input => stage(input) === "synthesis" ? JSON.stringify({ headline: "Unsupported", overview: "Unsupported", chapters: [], key_findings: [{ text: "Claim", evidence_refs: ["other-job-E01"] }], limitations: [] }) : fixtureComplete(input));
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.status).toBe("partial"); expect(job.summary?.headline).toContain("synthesis unavailable"); expect(job.summary?.key_findings).toEqual([]); expect(job.windows[0]!.events).toHaveLength(1);
  });
  it("does not narrate unsupported empty-citation summaries when the model retains no events", async () => {
    const s = session(6); const value = manager(async input => {
      if (stage(input) !== "window") return fixtureComplete(input);
      return JSON.stringify({ summary: "All steps were done perfectly", narration: "Everything passed", phase: "Complete", events: [], uncertainties: [], metric_ids: [] });
    });
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.windows[0]).toMatchObject({ summary: "No supported findings were retained for this sampled window.", narration: "", phase: "" });
    expect(job.summary?.headline).toBe("No supported findings retained");
  });
  it("normalizes real speech IDs and rejects transcript time leakage while keeping visual analysis", async () => {
    const s = session(12), readAudio = vi.fn(async ({ start_s }: any) => start_s === 0 ? { status: "available" as const, segments: [{ id: "audio-adapter-id", start_s: 1, end_s: 2, text: "Send the drawing" }], note: null } : { status: "available" as const, segments: [{ id: "leak", start_s: 1, end_s: 2, text: "wrong interval" }], note: null });
    const value = manager(fixtureComplete, { readAudio }); const job = await terminal(value, s, value.start(s, { ...request(s), include_audio: true }).id);
    expect(job.status).toBe("complete"); expect(job.audio.status).toBe("unavailable"); expect(job.windows[0]!.transcript[0]!.id).toBe("W0001-T01"); expect(job.windows[1]!.transcript).toEqual([]); expect(job.windows[1]!.uncertainties.join(" ")).toContain("Speech unavailable");
    expect(readAudio).toHaveBeenCalledTimes(2);
  });
  it("keeps absent audio explicit and never invents speech from images", async () => {
    const s = session(6), value = manager(); const job = await terminal(value, s, value.start(s, { ...request(s), include_audio: true }).id);
    expect(job.audio.status).toBe("unavailable"); expect(job.windows[0]!.transcript).toEqual([]); expect(job.summary?.limitations.join(" ")).toContain("Speech is unavailable");
  });
  it("does not claim an uploaded document from empty or automatically inferred workflow context", async () => {
    for (const inferred of [false, true]) {
      const s = session(6); s.filename = ""; s.text = ""; s.rows = [];
      if (inferred) { s.workflow.source = "inferred"; s.workflow.steps.forEach(step => step.source = "inferred"); }
      else { s.workflow.steps = []; s.workflow.source = "none"; }
      const value = manager(), job = await terminal(value, s, value.start(s, request(s)).id);
      expect(job.status).toBe("complete"); expect(job.reference.name).toBe("No reference document");
      expect(job.metric_plan.some(metric => metric.id === "document_criteria")).toBe(false);
    }
  });
  it("retains domain conflicts and applies an explicit operator override without claiming document expectations were seen", async () => {
    const s = session(6), value = manager(); const job = await terminal(value, s, value.start(s, { ...request(s), domain_override: "cooking" }).id);
    expect(job.domain).toMatchObject({ key: "cooking", basis: "operator", conflict: expect.stringContaining("Manufacturing") });
    expect(job.metrics.find(m => m.id === "critical_domain_metric")).toMatchObject({ status: "unavailable", label: "Food safety / internal temperature" });
    expect(job.metric_plan[0]!.id).toBe("cooking_ingredient_addition");
  });
  it("rejects domain plans from a foreign catalog rather than silently substituting generic metrics", async () => {
    const s = session(6), value = manager(async input => stage(input) === "domain" ? JSON.stringify({ domain: { key: "manufacturing", label: "Manufacturing", basis: "video", rationale: "Fixture", confidence: 0.7, conflict: null }, selected_metric_ids: ["surgery_field_exposure"] }) : fixtureComplete(input));
    const job = await terminal(value, s, value.start(s, request(s)).id); expect(job.status).toBe("failed"); expect(job.error).toContain("foreign metric"); expect(job.metric_plan).toEqual([]);
  });
  it("counts only real speech-supported meeting decisions and keeps missing action items unavailable", async () => {
    const s = session(6), readAudio = async () => ({ status: "available" as const, segments: [{ id: "speech-id", start_s: 1, end_s: 2, text: "We decided to send the drawing." }], note: null });
    const value = manager(async input => {
      if (stage(input) !== "window") return fixtureComplete(input);
      const data = payload(input), transcript = data.transcript[0];
      return JSON.stringify({ summary: "Fixture explicit decision.", narration: "The fixture records a decision to send the drawing.", phase: "Decision", events: [{ kind: "decision", label: "Send drawing", detail: transcript.text, start_s: 1, end_s: 2, frame_refs: [], transcript_refs: [transcript.id], metric_ids: ["meeting_decision"], certainty: "observed", uncertainty: null }], uncertainties: [], metric_ids: ["meeting_decision"] });
    }, { readAudio });
    const job = await terminal(value, s, value.start(s, { ...request(s), domain_override: "meeting", include_audio: true }).id);
    expect(job.metrics[0]).toMatchObject({ id: "meeting_decision", value: 1, status: "estimated" });
    expect(job.metrics[1]).toMatchObject({ id: "meeting_action_item", value: null, status: "unavailable" });
    expect(job.windows[0]!.events[0]!.metric_ids).toEqual(["meeting_decision"]);
  });
  it("rejects a meeting decision metric inferred from silent images", async () => {
    const s = session(6), value = manager(async input => {
      if (stage(input) !== "window") return fixtureComplete(input);
      const output = windowOutput(input); (output.events[0] as any).kind = "decision"; output.events[0]!.metric_ids = ["meeting_decision"]; return JSON.stringify(output);
    });
    const job = await terminal(value, s, value.start(s, { ...request(s), domain_override: "meeting" }).id);
    expect(job.status).toBe("failed"); expect(job.windows[0]!.error).toContain("does not support");
  });
  it("preserves union spans and distinct episode counts for every constrained domain catalog", () => {
    const s = session(6), value = manager(); const initial = value.start(s, request(s)); value.cancel(s, initial.id);
    const base = value.get(s, initial.id);
    for (const key of ["surgery", "construction", "manufacturing", "dance", "sports", "meeting", "cooking", "general"] as const) {
      const catalog = videoSummaryDomainCatalog(key), first = catalog[0]!;
      const job = structuredClone(base); job.domain = { key, label: key, basis: "video", rationale: "Fixture", confidence: 0.8, conflict: null }; job.metric_plan = createVideoSummaryMetricPlan(key, false, catalog.map(metric => metric.id));
      const event = { id: "W0001-E01", kind: first.event_kinds[0]!, label: "Fixture supported event", detail: "Fixture", start_s: 1, end_s: 3, frame_refs: first.requires_transcript ? [] : ["W0001-F01"], transcript_refs: first.requires_transcript ? ["W0001-T01"] : [], metric_ids: [first.id], certainty: "estimated" as const, uncertainty: "Fixture sampled interval" };
      job.windows = [{ id: "W0001", start_s: 0, end_s: 6, status: "complete", sampled_frames: [{ id: "W0001-F01", time_s: 1 }], transcript: first.requires_transcript ? [{ id: "W0001-T01", start_s: 1, end_s: 3, text: "Fixture commitment" }] : [], summary: "Fixture", narration: "Fixture", phase: "Fixture", events: [event, { ...event, id: "W0001-E02", start_s: 2, end_s: 4 }], uncertainties: [], error: null }];
      const metrics = deriveVideoSummaryMetrics(job); expect(metrics[0]).toMatchObject({ id: first.id, value: first.kind === "timing" ? 3 : 1, status: "estimated" });
      expect(metrics[1]).toMatchObject({ value: null, status: "unavailable" }); expect(metrics.find(metric => metric.id === "critical_domain_metric")?.value).toBeNull(); expect(job.metric_plan.length).toBeLessThanOrEqual(12);
      const timed = catalog.find(metric => metric.kind === "timing");
      if (timed) { job.windows[0]!.events.forEach(finding => finding.metric_ids = [timed.id]); expect(deriveVideoSummaryMetrics(job).find(metric => metric.id === timed.id)).toMatchObject({ value: 3, status: "estimated" }); }
    }
  });
  it("uses bounded hierarchical synthesis for long retained histories and keeps citation validity", async () => {
    const s = session(6 * 40), lengths: number[] = [], value = manager(async input => { if (stage(input) === "synthesis") lengths.push(input.prompt.length); return fixtureComplete(input); });
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.status).toBe("complete"); expect(job.windows).toHaveLength(40); expect(lengths.length).toBeGreaterThan(1); expect(Math.max(...lengths)).toBeLessThan(35000);
    const ids = new Set(job.windows.flatMap(w => w.events.map(e => e.id))); expect(job.summary!.key_findings.every(f => f.evidence_refs.every(ref => ids.has(ref)))).toBe(true);
  });
  it("processes the maximum 600 balanced windows without dropping the tail or growing temporal memory", async () => {
    const s = session(7200), calls: string[] = [], lengths: number[] = [];
    const value = manager(async input => {
      const data = payload(input);
      if (stage(input) === "window") { calls.push(data.window.id); expect(data.memory.length).toBeLessThanOrEqual(2); }
      if (stage(input) === "synthesis") lengths.push(input.prompt.length);
      return fixtureComplete(input);
    });
    const initial = value.start(s, { ...request(s), mode: "balanced" });
    await vi.waitFor(() => expect(value.get(s, initial.id).status).toBe("complete"), { timeout: 10000, interval: 20 });
    const job = value.get(s, initial.id);
    expect(calls).toHaveLength(600); expect(calls.at(-1)).toBe("W0600"); expect(job.windows.at(-1)!.end_s).toBe(7200);
    expect(job.progress).toMatchObject({ total_windows: 600, completed_windows: 600, sampled_frames: 3600, analyzed_through_s: 7200 });
    expect(Math.max(...lengths)).toBeLessThan(35000); expect(VideoSummaryJobSchema.safeParse(job).success).toBe(true);
  });
  it("does not retry permanent provider authorization errors and does not substitute fake success", async () => {
    const s = session(6), complete = vi.fn(async () => { throw Object.assign(new Error("Provider access denied"), { status: 401 }); });
    const value = manager(complete), job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.status).toBe("failed"); expect(complete).toHaveBeenCalledOnce(); expect(job.summary).toBeNull(); expect(job.error).toContain("Provider access denied");
  });
  it("runs detailed verification against the same images and retains only verified text and metric tags", async () => {
    const s = session(6); let proposedFrames: Buffer[] = []; const calls: string[] = [];
    const value = manager(async input => {
      calls.push(stage(input)!);
      if (stage(input) === "window") proposedFrames = input.frames;
      if (stage(input) === "verification") {
        expect(input.frames).toEqual(proposedFrames); const data = payload(input), output = data.proposed;
        output.summary = "Fixture verified narrower observation."; output.narration = "Fixture verified narration only.";
        output.events[0].metric_ids = []; return JSON.stringify(output);
      }
      return fixtureComplete(input);
    });
    const planned = value.plan(s, "detailed"); expect(planned.estimated_model_calls).toBe(4);
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(calls).toEqual(["domain", "window", "verification", "synthesis"]); expect(job.provenance.model_calls).toBe(4);
    expect(job.windows[0]).toMatchObject({ summary: "Fixture verified narrower observation.", narration: "Fixture verified narration only." });
    expect(job.metrics[0]).toMatchObject({ value: null, status: "unavailable" }); expect(job.progress.sampled_frames).toBe(9);
  });
  it("removes rejected clauses from narration when verification rejects every proposed finding", async () => {
    const s = session(6), value = manager(async input => {
      if (stage(input) !== "verification") return fixtureComplete(input);
      return JSON.stringify({ summary: "This cannot be verified.", narration: "Do not retain this unsupported voice text.", phase: "Unsupported", events: [], uncertainties: ["Fixture reviewer rejected an ambiguous episode."], metric_ids: [] });
    });
    const job = await terminal(value, s, value.start(s, request(s)).id);
    expect(job.windows[0]).toMatchObject({ events: [], narration: "", phase: "" }); expect(job.windows[0]!.summary).not.toContain("cannot be verified"); expect(job.summary!.headline).toBe("No supported findings retained");
  });
  it.each(["upgrade", "added episode", "expanded bounds"])("does not accept verification %s", async reason => {
    const s = session(6), value = manager(async input => {
      if (stage(input) !== "verification") return fixtureComplete(input);
      const output = payload(input).proposed;
      if (reason === "upgrade") { output.events[0].certainty = "observed"; output.events[0].uncertainty = null; }
      if (reason === "added episode") output.events.push(structuredClone(output.events[0]));
      if (reason === "expanded bounds") { output.events[0].start_s = 0; output.events[0].end_s = 6; }
      return JSON.stringify(output);
    });
    const job = await terminal(value, s, value.start(s, request(s)).id); expect(job.status).toBe("failed"); expect(job.windows[0]!.events).toEqual([]); expect(job.provenance.model_calls).toBe(5);
  });
  it("uses one visual pass in balanced mode and estimates verification only for detailed mode", async () => {
    const s = session(6), calls: string[] = [], value = manager(async input => { calls.push(stage(input)!); return fixtureComplete(input); });
    expect(value.plan(s, "balanced").estimated_model_calls).toBe(3);
    const job = await terminal(value, s, value.start(s, { ...request(s), mode: "balanced" }).id);
    expect(calls).toEqual(["domain", "window", "synthesis"]); expect(job.progress.sampled_frames).toBe(6); expect(job.provenance.model_calls).toBe(3);
  });
  it("redacts configured and recognizable credential substrings before polling exposes job or window errors", async () => {
    const previous = config.keys.openai; config.keys.openai = "fixture-private-provider-secret";
    try {
      const message = "Provider fixture-private-provider-secret denied sk-proj-example_private_key hf_example_private_token Bearer token123 api_key=secretValue";
      const safe = videoSummarySafeError(new Error(message));
      for (const secret of [config.keys.openai, "sk-proj-example_private_key", "hf_example_private_token", "token123", "secretValue"]) expect(safe).not.toContain(secret);
      const s = session(6), value = manager(async input => { if (stage(input) === "window") throw new Error(message); return fixtureComplete(input); });
      const job = await terminal(value, s, value.start(s, request(s)).id);
      expect(job.windows[0]!.error).toContain("[redacted]"); expect(JSON.stringify(job)).not.toContain(config.keys.openai);
      const other = session(6), domainFailure = manager(async () => { throw new Error(message); }); const failed = await terminal(domainFailure, other, domainFailure.start(other, request(other)).id);
      expect(failed.error).toContain("[redacted]"); expect(failed.error).not.toContain("secretValue");
    } finally { config.keys.openai = previous; }
  });
  it("keeps a cancelled report immutable when a new job resumes accepted windows", async () => {
    const s = session(12); let release!: () => void; let held = false; let delay = true;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const value = manager(async input => {
      if (stage(input) === "window" && payload(input).window.id === "W0002" && delay) { held = true; await wait; }
      return fixtureComplete(input);
    });
    const initial = value.start(s, request(s)); await vi.waitFor(() => expect(held).toBe(true));
    const cancelled = value.cancel(s, initial.id); expect(cancelled.windows).toHaveLength(1);
    expect(() => value.retry(s, initial.id)).toThrow("still finishing"); delay = false; release();
    let resumed: VideoSummaryJob | undefined;
    await vi.waitFor(() => { resumed = value.retry(s, initial.id); expect(resumed.id).not.toBe(initial.id); });
    const done = await terminal(value, s, resumed!.id);
    expect(done.status).toBe("complete"); expect(done.windows[0]).toEqual(cancelled.windows[0]); expect(value.get(s, initial.id)).toEqual(cancelled);
  });
});

describe("session-scoped bounded recap scheduling", () => {
  it("accounts terminal reports once, evicts the oldest by byte budget and preserves the newer immutable snapshot", async () => {
    const pilotSession = session(6), pilot = manager(), measured = await terminal(pilot, pilotSession, pilot.start(pilotSession, request(pilotSession)).id);
    const budget = Math.ceil(Buffer.byteLength(JSON.stringify(measured)) * 1.5);
    const value = manager(fixtureComplete, { terminalByteBudget: budget }), firstSession = session(6), secondSession = session(6);
    const original = JSON.stringify; let finalizedSerializations = 0;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation((data: any, replacer: any, space: any) => { if (data?.schema_version === 1 && data?.windows) finalizedSerializations++; return original(data, replacer, space); });
    try {
      const first = await terminal(value, firstSession, value.start(firstSession, request(firstSession)).id);
      for (let i = 0; i < 10; i++) { value.get(firstSession, first.id); value.current(firstSession); }
      expect(finalizedSerializations).toBe(1);
      const second = await terminal(value, secondSession, value.start(secondSession, request(secondSession)).id);
      expect(finalizedSerializations).toBe(2); expect(() => value.get(firstSession, first.id)).toThrow("not found");
      expect(value.get(secondSession, second.id)).toEqual(second);
      for (let i = 0; i < 10; i++) value.current(secondSession);
      expect(finalizedSerializations).toBe(2);
    } finally { stringify.mockRestore(); }
  });
  it("protects active and queued jobs when terminal byte retention is exhausted", async () => {
    const held: Array<() => void> = [];
    const value = manager(async input => {
      if (stage(input) === "domain") await new Promise<void>((resolve, reject) => { held.push(resolve); input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true }); });
      return fixtureComplete(input);
    }, { terminalByteBudget: 0 });
    const firstSession = session(6), secondSession = session(6), thirdSession = session(6);
    const first = value.start(firstSession, request(firstSession)); await vi.waitFor(() => expect(held).toHaveLength(1));
    const second = value.start(secondSession, request(secondSession)), third = value.start(thirdSession, request(thirdSession));
    held[0]!(); await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(() => value.get(firstSession, first.id)).toThrow("not found");
    expect(value.get(secondSession, second.id).status).toBe("planning"); expect(value.get(thirdSession, third.id).status).toBe("queued");
    await value.close();
  });
  it("preflights without model calls, enforces whole-source limits and rejects strict extra input fields", () => {
    const complete = vi.fn(fixtureComplete), value = manager(complete), s = session(3600);
    expect(value.plan(s, "detailed")).toMatchObject({ total_windows: 600, frames_per_window: 9, max_duration_s: 3600 });
    s.videoInfo!.duration = 3600.001; expect(() => value.plan(s, "detailed")).toThrow("exceeds 600"); expect(value.plan(s, "balanced").total_windows).toBe(301);
    expect(complete).not.toHaveBeenCalled(); expect(VideoSummaryStartSchema.safeParse({ ...request(s), account_key: "secret" }).success).toBe(false);
    s.videoInfo!.duration = 6;
    expect(() => value.start(s, { ...request(s), source_id: "previous" })).toThrow("Source or reference changed");
  });
  it("does not permit simulated success unless explicitly enabled with an injected completion", () => {
    expect(() => new VideoSummaryJobs({ allowMockForTests: true })).toThrow("explicit injected");
    const value = new VideoSummaryJobs({ complete: fixtureComplete, sampleFrames: sample }); managers.push(value);
    const s = session(6);
    // Test environment has no configured provider or is explicitly MOCK=1.
    const previous = config.mock; config.mock = true;
    try { expect(() => value.start(s, { ...request(s), provider: "local" })).toThrow("demo mode"); } finally { config.mock = previous; }
  });
  it("admits one active plus two queued jobs, reuses equivalent input, rejects conflicts, and never exposes another session", async () => {
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let first = true;
    const value = manager(async input => { if (first) { first = false; await held; } return fixtureComplete(input); });
    const sessions = [session(6), session(6), session(6), session(6)]; const one = value.start(sessions[0]!, request(sessions[0]!));
    await vi.waitFor(() => expect(first).toBe(false));
    expect(value.start(sessions[0]!, request(sessions[0]!)).id).toBe(one.id);
    expect(() => value.start(sessions[0]!, { ...request(sessions[0]!), mode: "balanced" })).toThrow("different recap");
    const two = value.start(sessions[1]!, request(sessions[1]!)), three = value.start(sessions[2]!, request(sessions[2]!));
    expect(two.status).toBe("queued"); expect(three.status).toBe("queued"); expect(() => value.start(sessions[3]!, request(sessions[3]!))).toThrow("queue is full");
    expect(() => value.get(sessions[1]!, one.id)).toThrow("not found");
    value.cancel(sessions[1]!, two.id); expect(value.start(sessions[3]!, request(sessions[3]!)).status).toBe("queued"); release();
    await terminal(value, sessions[0]!, one.id); await terminal(value, sessions[2]!, three.id);
  });
  it("guards the full instruction definition and preferences while excluding seek, progress and confirmation changes", () => {
    const s = session(), fingerprint = videoSummaryContextFingerprint(s);
    s.lastTime = 15; s.revision++; s.currentId = "S1"; s.workflow.steps[0]!.complete = true; s.workflow.steps[0]!.criteria[0]!.status = "met";
    expect(videoSummaryContextFingerprint(s)).toBe(fingerprint);
    s.workflow.steps[0]!.objective = "New instruction"; expect(videoSummaryContextFingerprint(s)).not.toBe(fingerprint);
    const changed = videoSummaryContextFingerprint(s); s.preferencesRevision!++; expect(videoSummaryContextFingerprint(s)).not.toBe(changed);
  });
  it.each(["source", "definition", "goals", "disposed"])("aborts %s changes and refuses late completion writes or stale retries", async change => {
    const s = session(6); let release!: () => void; let called = false; const held = new Promise<void>(resolve => { release = resolve; });
    const value = manager(async input => { called = true; await held; return fixtureComplete(input); }); const initial = value.start(s, request(s));
    await vi.waitFor(() => expect(called).toBe(true));
    if (change === "source") s.mediaGeneration++;
    if (change === "definition") s.workflow.steps[0]!.actions.push("Different action");
    if (change === "goals") s.operatorGoals = "Different goals";
    if (change === "disposed") s.disposed = true;
    expect(value.current(s)).toBeNull(); release(); await terminal(value, s, initial.id);
    expect(value.get(s, initial.id)).toMatchObject({ status: "stale", domain: null, windows: [] }); expect(() => value.retry(s, initial.id)).toThrow("changed");
  });
  it("cancels active and queued work, stops the provider signal and closes before new admission", async () => {
    let called = false;
    const value = manager(input => new Promise((_resolve, reject) => { called = true; input.signal!.addEventListener("abort", () => reject(input.signal!.reason), { once: true }); }));
    const s = session(), other = session(); const first = value.start(s, request(s)); await vi.waitFor(() => expect(called).toBe(true)); const queued = value.start(other, request(other));
    value.cancel(s, first.id); expect(value.get(s, first.id).status).toBe("cancelled"); await value.close();
    expect(value.get(other, queued.id).status).toBe("cancelled"); expect(() => value.start(s, request(s))).toThrow("shutting down");
  });
  it("unions overlapping sampled intervals without double counting or propagating malformed numbers", () => {
    expect(intervalUnion([[0, 5], [3, 7], [7, 9], [20, 22], [NaN, 33], [8, 2]])).toBe(11);
  });
});
