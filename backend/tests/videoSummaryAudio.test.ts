import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createVideoSummaryAudioReader, extractSummaryAudio, summaryTranscriptSegments } from "../src/media/videoSummaryAudio.js";

let directory: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "cueveris-recap-audio-"));
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=16000", "-t", "2", path.join(directory, "tone.wav")]);
});
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
const interval = () => ({ path: path.join(directory, "tone.wav"), start_s: 0.5, end_s: 1.5, signal: new AbortController().signal });

describe("bounded source-audio evidence", () => {
  it("decodes genuine bounded PCM and does not manufacture a track for silent video", async () => {
    const wav = await extractSummaryAudio(interval());
    expect(wav?.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav!.length).toBeGreaterThan(31000); expect(wav!.length).toBeLessThan(33000);
    expect(await extractSummaryAudio({ ...interval(), path: path.resolve("../evaluation/assets/parts-sorting.mp4") })).toBeNull();
  });
  it("rejects invalid bounds and cancellation before starting a decoder", async () => {
    await expect(extractSummaryAudio({ ...interval(), end_s: 90 })).rejects.toThrow("at most 30 seconds");
    await expect(extractSummaryAudio({ ...interval(), signal: AbortSignal.abort(new Error("cancelled by user")) })).rejects.toThrow("cancelled by user");
  });
  it("offsets actual speech timestamps, creates stable IDs and preserves quotation text", () => {
    const raw = { segments: [{ start: 0.2, end: 1.1, text: "  Install the camera mount.  " }] };
    const result = summaryTranscriptSegments(raw, { start_s: 12, end_s: 18 });
    expect(result.segments[0]).toMatchObject({ start_s: 12.2, end_s: 13.1, text: "Install the camera mount." });
    expect(result).toEqual(summaryTranscriptSegments(raw, { start_s: 12, end_s: 18 }));
  });
  it("does not turn uncertain speech, invalid intervals or source-external times into evidence", () => {
    const segments = [
      { start: 0, end: 1, text: "noise", no_speech_prob: 0.99 },
      { start: 0, end: 1, text: "uncertain", avg_logprob: -2 },
      { start: 0, end: 1, text: "repeated", compression_ratio: 4 },
      { start: 2, end: 1, text: "reversed" }, { start: 0, end: 8, text: "future" },
      { start: 0.5, end: 1, text: "Actual retained speech" },
    ];
    const result = summaryTranscriptSegments({ segments }, { start_s: 30, end_s: 36 });
    expect(result.rejected).toBe(5); expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.text).toBe("Actual retained speech");
    expect(() => summaryTranscriptSegments({ segments: [{ start: NaN, end: 1, text: "x" }] }, { start_s: 0, end_s: 6 })).toThrow();
  });
  it("makes no speech request when no audio exists or the provider is unconfigured", async () => {
    expect(createVideoSummaryAudioReader({ apiKey: "" })).toBeUndefined();
    const transcribe = vi.fn();
    const reader = createVideoSummaryAudioReader({ transcribe, extract: async () => null })!;
    expect((await reader(interval())).status).toBe("no_audio"); expect(transcribe).not.toHaveBeenCalled();
  });
  it("marks provider failures unavailable without leaking credentials or fabricating a transcript", async () => {
    const reader = createVideoSummaryAudioReader({ extract: async () => Buffer.from("fixture"), transcribe: async () => { throw new Error("sk-private-test-credential"); } })!;
    const result = await reader(interval());
    expect(result.status).toBe("unavailable"); expect(result.segments).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("sk-private");
  });
  it("propagates cancellation during transcription instead of returning an unavailable success", async () => {
    const controller = new AbortController();
    const reader = createVideoSummaryAudioReader({ extract: async () => Buffer.from("fixture"), transcribe: async (_wav, signal) => {
      controller.abort(new Error("source changed")); signal.throwIfAborted(); return {};
    } })!;
    await expect(reader({ ...interval(), signal: controller.signal })).rejects.toThrow("source changed");
  });
});
