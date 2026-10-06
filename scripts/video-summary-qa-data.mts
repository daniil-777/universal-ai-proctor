import { createHash } from "node:crypto";
import type { Complete } from "../backend/src/llm/client.js";
import type { DomainKey } from "../backend/src/domain/videoSummary.js";

export const SUMMARY_QA_MODES = ["valid", "partial", "invalid_refs", "invalid_time", "foreign_metric", "foreign_finding_metric", "slow", "duplicate", "meeting_audio", "verification_rejects"] as const;
export type SummaryQaMode = typeof SUMMARY_QA_MODES[number];
export interface SummaryQaControl { mode: SummaryQaMode; domain: DomainKey; delay_ms: number; tts_delay_ms: number }
export interface SummaryQaCall { stage: string; window: string | null; start_s: number | null; end_s: number | null; frame_count: number; frame_hashes: string[]; prompt_chars: number; at: number; outcome: string }
export interface SummaryQaSpeech { text: string; at: number; sent: boolean; cancelled: boolean }
export const initialSummaryQaControl = (): SummaryQaControl => ({ mode: "valid", domain: "manufacturing", delay_ms: 0, tts_delay_ms: 0 });

export function abortableDelay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason || new Error("QA request cancelled")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

// Deterministic provider output for the real manager. This is not an AI accuracy
// benchmark: the decoder is real, while all descriptions are explicitly simulated.
export function summaryQaComplete(getControl: () => SummaryQaControl, calls: SummaryQaCall[]): Complete {
  return async input => {
    input.signal?.throwIfAborted();
    const marker = /VIDEO_SUMMARY_STAGE:\s*(domain|window|verification|synthesis)\s*/.exec(input.prompt);
    if (!marker) throw new Error("QA provider received an unknown prompt contract");
    const payload = JSON.parse(input.prompt.slice(marker.index + marker[0].length)) as {
      window?: { id: string; start_s: number; end_s: number };
      sampled_frames?: { id: string; time_s: number }[];
      metric_plan?: { id: string }[];
      metric_catalog?: { id: string; domain_key: DomainKey }[];
      domain_override?: DomainKey | null;
      domain?: { key: DomainKey };
      transcript?: { id: string; start_s: number; end_s: number; text: string }[];
    };
    const stage = marker[1]!;
    const window = payload.window;
    const call: SummaryQaCall = {
      stage, window: window?.id || null, start_s: window?.start_s ?? null, end_s: window?.end_s ?? null,
      frame_count: input.frames.length, frame_hashes: input.frames.map(frame => createHash("sha256").update(frame).digest("hex")),
      prompt_chars: input.prompt.length, at: Date.now(), outcome: "pending",
    };
    calls.push(call);
    try {
      const control = { ...getControl() };
      if (control.delay_ms) await abortableDelay(control.delay_ms, input.signal);
      for (const frame of input.frames) if (frame[0] !== 0xff || frame[1] !== 0xd8) throw new Error("QA manager did not supply decoded JPEGs");
      let result: unknown;
      if (stage === "domain") result = { domain: { key: control.domain, label: control.domain[0]!.toUpperCase() + control.domain.slice(1), basis: "both", rationale: "Simulated domain selection for isolated QA; not a real classification.", confidence: 0.7, conflict: null }, selected_metric_ids: (payload.metric_catalog || []).filter(metric => metric.domain_key === (payload.domain_override || control.domain)).slice(0, 2).map(metric => metric.id) };
      else if (stage === "synthesis") result = { headline: "Simulated synthetic-video recap", overview: "These are deterministic QA descriptions of a generated test pattern. No real process, clinical outcome or physical measurement has been assessed.", chapters: [], key_findings: [], limitations: ["Simulated provider output; real sampled JPEG decoding only.", "Sampling cannot establish exhaustive counts or hidden measurements."] };
      else {
        if (!window) throw new Error("QA window payload is missing its bounds");
        const frames = payload.sampled_frames || [];
        if (!frames.length || input.frames.length !== frames.length) throw new Error("QA frame IDs and image buffers disagree");
        const ordinal = Math.floor(window.start_s / 6) + 1;
        if (control.mode === "partial" && ordinal === 2) throw new Error("Simulated unavailable analysis window for manual retry QA");
        const domain = payload.domain?.key || control.domain;
        const plannedDomainIds = (payload.metric_plan || []).filter(metric => metric.id.startsWith(`${domain}_`)).map(metric => metric.id);
        const event = { kind: "action", label: `Simulated test-pattern episode ${ordinal}`, detail: "Simulated observation; source pixels are generated testsrc2, not a manufacturing or surgical task.", start_s: frames[0]!.time_s, end_s: frames.at(-1)!.time_s, frame_refs: [frames[0]!.id, frames.at(-1)!.id], transcript_refs: [] as string[], metric_ids: domain === "meeting" ? [] : plannedDomainIds.slice(0, 1), certainty: "estimated", uncertainty: "Sparse samples do not establish an exhaustive physical action count." };
        if (control.mode === "meeting_audio") {
          const transcript = payload.transcript?.[0];
          if (!transcript) throw new Error("Simulated meeting fixture requires its explicit transcript");
          event.kind = "decision"; event.label = `Simulated spoken decision ${ordinal}`;
          event.detail = transcript.text; event.start_s = transcript.start_s; event.end_s = transcript.end_s;
          event.frame_refs = []; event.transcript_refs = [transcript.id]; event.metric_ids = ["meeting_decision"];
          event.uncertainty = "Explicit synthetic transcript tests citation transport; no actual speaker or decision adoption was verified.";
        }
        if (control.mode === "invalid_refs" && ordinal === 2) event.frame_refs = ["foreign-source-frame"];
        if (control.mode === "invalid_time" && ordinal === 2) event.end_s = window.end_s + 500;
        if (control.mode === "foreign_finding_metric" && ordinal === 2) event.metric_ids = ["foreign-domain-metric"];
        const metricIds = (payload.metric_plan || []).slice(0, 1).map(metric => metric.id);
        if (control.mode === "foreign_metric" && ordinal === 2) metricIds.splice(0, metricIds.length, "foreign-domain-metric");
        result = { summary: `Simulated window ${ordinal}: decoded synthetic test pattern.`, narration: `Simulated window ${ordinal}. This is a generated test pattern, with no real process assessment.`, phase: `Simulated phase ${ordinal}`, events: control.mode === "duplicate" ? [event, { ...event }] : [event], uncertainties: ["Generated footage and deterministic provider output are for QA only."], metric_ids: metricIds };
        if (control.mode === "verification_rejects" && stage === "verification") result = { summary: "The simulated verifier retained no process finding.", narration: "", phase: "", events: [], uncertainties: ["Simulated precision review removed unsupported primary findings."], metric_ids: [] };
      }
      call.outcome = "returned";
      return JSON.stringify(result);
    } catch (error) { call.outcome = input.signal?.aborted ? "cancelled" : "failed"; throw error; }
  };
}

// Actual audible PCM WAV, intentionally a short synthetic tone, not claimed to
// be synthesized speech. It exercises the production audio playback transport.
export function summaryQaWav(seconds = 0.8) {
  const rate = 16000, samples = Math.round(seconds * rate), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / rate) * 1500 * Math.min(1, i / 160, (samples - i) / 160)), 44 + i * 2);
  return buffer;
}
