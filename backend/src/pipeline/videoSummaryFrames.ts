import fs from "node:fs";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

export interface VideoFrameSample { buffer: Buffer; time_s: number }
export interface VideoFrameSampleInput { path: string; start_s: number; end_s: number; count: number; signal: AbortSignal }
export type VideoFrameSampler = (input: VideoFrameSampleInput) => Promise<VideoFrameSample[]>;
const staticPath = ffmpegStatic as unknown as string | null;
const ffmpeg = (): string => process.env.FFMPEG_PATH || (staticPath && fs.existsSync(staticPath) ? staticPath : "ffmpeg");

// Copy timestamps through input seeking: showinfo reports decoded source PTS,
// rather than treating a requested seek time as observed frame evidence.
async function extract(path: string, target: number, signal: AbortSignal): Promise<VideoFrameSample> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg(), ["-hide_banner", "-loglevel", "info", "-nostdin", "-copyts", "-ss", String(target), "-i", path, "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease,showinfo", "-fps_mode", "passthrough", "-threads", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let bytes = 0; let stderr = ""; let failure: Error | undefined;
    const fail = (error: Error) => { failure ||= error; child.kill("SIGKILL"); };
    const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error("Video sampling cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => fail(new Error("Video frame decoding timed out.")), 20000);
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) fail(new Error("Decoded frame exceeds the buffer limit.")); else chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-64000); });
    child.on("error", error => { failure ||= error; });
    child.on("close", code => {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      const match = /\bpts_time:([\d.eE+-]+)/.exec(stderr);
      const time_s = Number(match?.[1]);
      if (code !== 0 || !bytes || !match || !Number.isFinite(time_s) || time_s < 0) return reject(new Error("Could not decode a timestamped source frame."));
      resolve({ buffer: Buffer.concat(chunks), time_s });
    });
  });
}

export const sampleVideoSummaryFrames: VideoFrameSampler = async input => {
  const { path, start_s, end_s, signal } = input;
  if (!Number.isFinite(start_s) || !Number.isFinite(end_s) || start_s < 0 || end_s <= start_s) throw new Error("Invalid sampling interval.");
  const count = Math.min(9, Math.max(1, Math.floor(input.count)));
  const result: VideoFrameSample[] = [];
  for (let i = 0; i < count; i++) {
    signal.throwIfAborted();
    const target = Math.max(start_s, Math.min(end_s - 0.08, start_s + (end_s - start_s) * (i + 0.5) / count));
    const frame = await extract(path, target, signal);
    // A frame past a very short window's boundary must not become its evidence.
    if (frame.time_s >= start_s - 0.001 && frame.time_s <= end_s + 0.001 && !result.some(previous => Math.abs(previous.time_s - frame.time_s) < 0.0001)) result.push(frame);
  }
  if (!result.length) throw new Error("No source frames fall within this analysis window.");
  return result;
};
