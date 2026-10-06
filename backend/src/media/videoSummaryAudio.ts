import { spawn } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import OpenAI, { toFile } from "openai";
import pLimit from "p-limit";
import { z } from "zod";
import { config } from "../config.js";
import type { AudioReadInput, ReadAudio, VideoSummaryTranscript } from "../domain/videoSummary.js";

const bundled = ffmpegStatic as unknown as string | null;
const ffmpeg = process.env.FFMPEG_PATH || (bundled && fs.existsSync(bundled) ? bundled : "ffmpeg");
const audioPool = pLimit(1);
const MAX_AUDIO_BYTES = 2_100_000;
const Segment = z.object({
  start: z.number().finite().nonnegative(), end: z.number().finite().nonnegative(), text: z.string().max(8000),
  avg_logprob: z.number().finite().optional(), no_speech_prob: z.number().finite().optional(), compression_ratio: z.number().finite().optional(),
});
const Transcription = z.object({ segments: z.array(Segment).max(200) });

/** Decode only a bounded source interval; no files, shell or unbounded pipe. */
export async function extractSummaryAudio(input: AudioReadInput): Promise<Buffer | null> {
  if (!Number.isFinite(input.start_s) || !Number.isFinite(input.end_s) || input.start_s < 0 || input.end_s <= input.start_s || input.end_s - input.start_s > 30)
    throw new Error("Speech extraction requires an interval of at most 30 seconds.");
  input.signal.throwIfAborted();
  return audioPool(() => new Promise<Buffer | null>((resolve, reject) => {
    input.signal.throwIfAborted();
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", input.start_s.toFixed(6), "-i", input.path,
      "-t", (input.end_s - input.start_s).toFixed(6), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-f", "wav", "pipe:1"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = []; let length = 0, stderr = "", failure: Error | null = null;
    const stop = (error: Error) => { failure ||= error; child.kill("SIGKILL"); };
    const abort = () => stop(new Error("Speech extraction cancelled."));
    const timeout = setTimeout(() => stop(new Error("Speech extraction timed out.")), 20_000);
    input.signal.addEventListener("abort", abort, { once: true });
    const dispose = () => { clearTimeout(timeout); input.signal.removeEventListener("abort", abort); };
    child.stdout.on("data", (bytes: Buffer) => { length += bytes.length; if (length > MAX_AUDIO_BYTES) stop(new Error("Speech extraction exceeded its byte limit.")); else chunks.push(bytes); });
    child.stderr.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4000); });
    child.once("error", error => { dispose(); reject(error); });
    child.once("close", code => {
      dispose();
      if (failure) return reject(failure);
      if (input.signal.aborted) return reject(new Error("Speech extraction cancelled."));
      if (code !== 0 && /matches no streams|does not contain any stream/i.test(stderr)) return resolve(null);
      if (code !== 0 || length < 44) return reject(new Error("The video's audio could not be decoded."));
      resolve(Buffer.concat(chunks, length));
    });
    if (input.signal.aborted) abort();
  }));
}

export function summaryTranscriptSegments(raw: unknown, input: Pick<AudioReadInput, "start_s" | "end_s">): { segments: VideoSummaryTranscript[]; rejected: number } {
  const parsed = Transcription.parse(raw); const duration = input.end_s - input.start_s;
  let rejected = 0;
  const segments = parsed.segments.flatMap(segment => {
    const text = segment.text.trim();
    if (!text || segment.end <= segment.start || segment.start >= duration || segment.end > duration + 0.25 ||
        (segment.avg_logprob !== undefined && segment.avg_logprob < -1) ||
        (segment.no_speech_prob !== undefined && segment.no_speech_prob > 0.6) ||
        (segment.compression_ratio !== undefined && segment.compression_ratio > 2.4)) { rejected++; return []; }
    const start_s = input.start_s + segment.start, end_s = Math.min(input.end_s, input.start_s + segment.end);
    const id = `A-${crypto.createHash("sha256").update(JSON.stringify([start_s, end_s, text])).digest("hex").slice(0, 24)}`;
    return [{ id, start_s, end_s, text }];
  }).sort((a, b) => a.start_s - b.start_s || a.end_s - b.end_s);
  return { segments, rejected };
}

type Transcribe = (wav: Buffer, signal: AbortSignal) => Promise<unknown>;
export function createVideoSummaryAudioReader(options: { transcribe?: Transcribe; extract?: typeof extractSummaryAudio; apiKey?: string } = {}): ReadAudio | undefined {
  const key = options.apiKey ?? config.keys.openai;
  if (!key && !options.transcribe) return undefined;
  let client: OpenAI | undefined;
  const transcribe: Transcribe = options.transcribe || (async (wav, signal) => {
    client ||= new OpenAI({ apiKey: key, maxRetries: 0, timeout: 45_000 });
    // Segment timestamps keep quotations tied to actual source audio. No speaker
    // identity or speaker-time metric is inferred from this transcription model.
    return client.audio.transcriptions.create({ file: await toFile(wav, "source-window.wav", { type: "audio/wav" }),
      model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["segment"], temperature: 0 }, { signal });
  });
  return async input => {
    input.signal.throwIfAborted();
    try {
      const wav = await (options.extract || extractSummaryAudio)(input);
      input.signal.throwIfAborted();
      if (wav === null) return { status: "no_audio", segments: [], note: "This source has no audio track. Speech and speaker metrics are unavailable." };
      const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45_000)]);
      const result = summaryTranscriptSegments(await transcribe(wav, signal), input);
      input.signal.throwIfAborted();
      return { status: "available", segments: result.segments, note: result.rejected
        ? "Uncertain or out-of-range speech segments were omitted. Automatic transcription can contain errors."
        : "Speech is automatically transcribed with source timestamps; speaker identities are not inferred." };
    } catch {
      input.signal.throwIfAborted();
      return { status: "unavailable", segments: [], note: "Speech could not be transcribed for this interval. The recap retains visual evidence and marks missing speech explicitly." };
    }
  };
}
