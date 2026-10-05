// src/pipeline/frames.ts — video frame extraction + image ops (spec §5.1 / §5.1a).
// Uses ffmpeg/ffprobe via child_process for frame-accurate sampling (reproducing
// OpenCV by-index frames), and sharp for crop/resize/mosaic. ffmpeg binary comes
// from ffmpeg-static; ffprobe is resolved from env / sibling / PATH.
//
// NOTE: compilation does not require the ffmpeg/ffprobe binaries; running does.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import pLimit from "p-limit";
import ffmpegStatic from "ffmpeg-static";

export type CropRect = [number, number, number, number]; // normalized x1,y1,x2,y2 in [0,1]
export interface SampleOptions {
  compress?: boolean;
  recentMotion?: boolean;
  cropRect?: CropRect;
  onSampleTimes?: (times: number[]) => void;
}

export interface VideoInfo {
  fps: number;
  totalFrames: number;
  duration: number;
  width: number;
  height: number;
  variableFrameRate?: boolean;
}

// ffmpeg-static's typings resolve awkwardly under NodeNext; coerce to string|null.
// The bundled binary may be absent (installed with --ignore-scripts); only use it
// when it actually exists on disk, otherwise fall back to `ffmpeg` on PATH.
const ffmpegBin: string | null =
  (ffmpegStatic as unknown as string | null) ?? null;
const ffmpegBinReal: string | null =
  ffmpegBin && fs.existsSync(ffmpegBin) ? ffmpegBin : null;
const FFMPEG: string = process.env.FFMPEG_PATH || ffmpegBinReal || "ffmpeg";

function resolveFfprobe(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  if (ffmpegBinReal) {
    const sib = path.join(
      path.dirname(ffmpegBinReal),
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
    if (fs.existsSync(sib)) return sib;
  }
  return "ffprobe";
}
const FFPROBE: string = resolveFfprobe();

// Bound concurrent ffmpeg processes so heavy extraction can't swamp the box.
const limit = pLimit(Number(process.env.FFMPEG_CONCURRENCY || 2));

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

// ── ffmpeg / ffprobe process helpers ─────────────────────────────────────────

function runFfmpegRaw(
  args: string[],
  timeoutMs = 120_000,
  onDiagnostics?: (text: string) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      onDiagnostics?.(Buffer.concat(err).toString());
      const buf = Buffer.concat(out);
      if (code === 0 || buf.length > 0) resolve(buf);
      else
        reject(
          new Error(
            `ffmpeg exit ${code}: ${Buffer.concat(err).toString().slice(-400)}`,
          ),
        );
    });
  });
}

function runFfmpegFile(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exit ${code}: ${Buffer.concat(err).toString().slice(-300)}`,
          ),
        );
    });
  });
}

function runProbe(videoPath: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate,avg_frame_rate,nb_frames,width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      videoPath,
    ];
    const proc = spawn(FFPROBE, args, { windowsHide: true });
    const out: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffprobe timeout"));
    }, timeoutMs);
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString());
      else reject(new Error(`ffprobe exit ${code}`));
    });
  });
}

function evalRatio(r: unknown): number {
  if (typeof r !== "string" || !r) return 0;
  const [a, b] = r.split("/");
  const num = Number(a);
  const den = b === undefined ? 1 : Number(b);
  if (!den || !Number.isFinite(num)) return 0;
  return num / den;
}

// ── probe (cached per path) ──────────────────────────────────────────────────

const probeCache = new Map<string, VideoInfo>();

export async function probeVideo(videoPath: string): Promise<VideoInfo> {
  const cached = probeCache.get(videoPath);
  if (cached) return cached;

  let info: VideoInfo;
  try {
    const json = JSON.parse(await runProbe(videoPath)) as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    const stream = json.streams?.[0] ?? {};
    let fps = evalRatio(stream.r_frame_rate);
    if (!fps) fps = evalRatio(stream.avg_frame_rate);
    if (!fps || !Number.isFinite(fps)) fps = 25.0;
    const duration = Number(json.format?.duration ?? 0) || 0;
    let totalFrames = Number(stream.nb_frames ?? 0) || 0;
    if (totalFrames <= 0) totalFrames = Math.round(duration * fps);
    info = {
      fps,
      totalFrames,
      duration,
      width: Number(stream.width ?? 0) || 0,
      height: Number(stream.height ?? 0) || 0,
      variableFrameRate: Math.abs(evalRatio(stream.avg_frame_rate) - fps) > fps * 0.02,
    };
  } catch {
    info = { fps: 25.0, totalFrames: 0, duration: 0, width: 0, height: 0 };
  }
  if (probeCache.size >= 500)
    probeCache.delete(probeCache.keys().next().value!);
  probeCache.set(videoPath, info);
  return info;
}

// ── index maths (verbatim formula from _PhaseWorker / _sample_from_file) ──────

export function evenIndices(
  winStart: number,
  winEnd: number,
  nSamples: number,
): number[] {
  const n = Math.min(nSamples, winEnd - winStart + 1);
  if (n <= 0) return [];
  const idxs: number[] = [];
  for (let i = 0; i < n; i++) {
    idxs.push(
      winStart + Math.trunc((i * (winEnd - winStart)) / Math.max(n - 1, 1)),
    );
  }
  return idxs;
}

// Keep the image budget unchanged while retaining enough fresh views to inspect
// movement. Older samples remain context; the final three span at most 0.8s.
export function windowSampleIndices(
  frameCount: number,
  fps: number,
  count: number,
  recentMotion = false,
): number[] {
  const end = Math.max(0, frameCount - 1);
  const budget = Math.max(1, Math.min(frameCount, Math.floor(count)));
  if (recentMotion && budget === 1) return [end];
  if (!recentMotion || budget < 3 || frameCount <= fps)
    return [...new Set(evenIndices(0, end, budget))];
  const freshCount = Math.min(3, budget);
  const recentStart = Math.max(0, end - Math.round(fps * 0.8));
  const contextCount = budget - freshCount;
  const context = contextCount
    ? contextCount === 1 ? [0] : evenIndices(0, Math.max(0, recentStart - 1), contextCount)
    : [];
  return [...new Set([...context, ...evenIndices(recentStart, end, freshCount)])].sort((a,b)=>a-b);
}

// Score small, localized action changes as well as whole-scene changes. Looking
// at the four most changed tiles avoids diluting a moving hand/foot in a largely
// static background. These pixels select evidence; they never classify a phase.
function visualDistance(a: Buffer, b: Buffer): number {
  const tiles = Array<number>(16).fill(0);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    const offset = (y * 32 + x) * 3;
    const tile = Math.floor(y / 6) * 4 + Math.floor(x / 8);
    for (let c = 0; c < 3; c++)
      tiles[tile]! += Math.abs(a[offset + c]! - b[offset + c]!);
  }
  return tiles.sort((a, b) => b - a).slice(0, 4)
    .reduce((sum, value) => sum + value, 0) / (4 * 48 * 3 * 255);
}

async function chooseMotionFrames(
  frames: Buffer[],
  times: number[],
  preferredTimes: number[],
  budget: number,
  cropRect?: CropRect,
): Promise<number[]> {
  const features = await Promise.all(frames.map(async frame => {
    let image = sharp(frame);
    if (cropRect) {
      const meta = await image.metadata();
      const W = meta.width ?? 0, H = meta.height ?? 0;
      if (W && H) {
        const [x1, y1, x2, y2] = cropRect;
        const left = clamp(Math.round(x1 * W), 0, W - 1);
        const top = clamp(Math.round(y1 * H), 0, H - 1);
        image = image.extract({ left, top,
          width: clamp(Math.round((x2 - x1) * W), 1, W - left),
          height: clamp(Math.round((y2 - y1) * H), 1, H - top) });
      }
    }
    return image.resize(32, 24, { fit: "fill" }).removeAlpha().toColourspace("srgb")
      .raw().toBuffer();
  }));
  const nearest = (time: number) => times.reduce((best, value, index) =>
    Math.abs(value - time) < Math.abs(times[best]! - time) ? index : best, 0);
  // Retain a bridge immediately before the fresh group as well: after a camera
  // change, that view may hold the current episode's clearest lift/contact.
  // Whole-window novelty alone otherwise spends these slots on old scenes.
  const recent = new Set(preferredTimes.slice(-4).map(nearest));
  const selected = new Set([0, ...recent]);
  // Spend up to three remaining slots on distinct recent action states before
  // selecting globally novel older scenes. This is generic temporal coverage,
  // not a camera-cut classifier or an assumption of episode continuity.
  for (let slot = 0; slot < 3 && selected.size < budget; slot++) {
    let recentAction = -1;
    let recentNovelty = 0.004;
    for (let i = 0; i < features.length; i++) {
      if (selected.has(i) || times[i]! < times.at(-1)! - 2) continue;
      const difference = Math.min(...[...recent]
        .map(index => visualDistance(features[i]!, features[index]!)));
      if (difference > recentNovelty) { recentAction = i; recentNovelty = difference; }
    }
    if (recentAction < 0) break;
    recent.add(recentAction);
    selected.add(recentAction);
  }
  while (selected.size < Math.min(budget, frames.length)) {
    let best = -1;
    let novelty = 0.004; // Suppress near-identical JPEG noise/held views.
    for (let i = 0; i < features.length; i++) {
      if (selected.has(i)) continue;
      const difference = Math.min(...[...selected]
        .map(index => visualDistance(features[i]!, features[index]!)));
      if (difference > novelty) { best = i; novelty = difference; }
    }
    if (best < 0) break;
    selected.add(best);
  }
  return [...selected].sort((a, b) => a - b);
}


// ── frame-accurate extraction (single-pass select filter → MJPEG pipe) ───────

function splitJpegs(buf: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  const n = buf.length;
  let i = 0;
  while (i < n - 1) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
      let j = i + 2;
      while (j < n - 1 && !(buf[j] === 0xff && buf[j + 1] === 0xd9)) j++;
      if (j < n - 1) {
        frames.push(buf.subarray(i, j + 2));
        i = j + 2;
        continue;
      }
      break;
    }
    i++;
  }
  return frames;
}

/** Extract exact frames by 0-based decoded index (same basis as CAP_PROP_POS_FRAMES). */
export async function extractFramesByIndices(
  videoPath: string,
  indices: number[],
): Promise<Buffer[]> {
  if (!indices.length) return [];
  const uniqueSorted = [...new Set(indices)].sort((a, b) => a - b);
  const sel = uniqueSorted.map((i) => `eq(n\\,${i})`).join("+");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-vf",
    `select='${sel}'`,
    "-fps_mode",
    "passthrough",
    "-frames:v",
    String(uniqueSorted.length),
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ];
  const out = await limit(() => runFfmpegRaw(args));
  const decoded = splitJpegs(out);

  // Map decoded frames back to their requested indices, preserving caller order.
  const byIndex = new Map<number, Buffer>();
  uniqueSorted.forEach((idx, k) => {
    const f = decoded[k];
    if (f) byIndex.set(idx, f);
  });
  return indices
    .map((i) => byIndex.get(i))
    .filter((b): b is Buffer => Boolean(b));
}

export async function extractFrameAt(
  videoPath: string,
  index: number,
): Promise<Buffer | null> {
  const frames = await extractFramesByIndices(videoPath, [
    Math.max(0, Math.trunc(index)),
  ]);
  return frames[0] ?? null;
}

// ── sharp helpers ────────────────────────────────────────────────────────────

export async function resizeLongEdge(
  buf: Buffer,
  maxEdge = 640,
): Promise<Buffer> {
  return sharp(buf)
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export async function compressTo(buf: Buffer, size = 640): Promise<Buffer> {
  return sharp(buf)
    .resize(size, size, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export function frameToJpegBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/** Tiny base64 JPEG previews of the frames actually sent to the LLM (prompt log UI). */
export async function makeThumbsB64(
  frames: Buffer[],
  maxEdge = 160,
  maxCount = 9,
): Promise<string[]> {
  const out = await Promise.all(
    frames.slice(0, maxCount).map(async (f) => {
      try {
        const buf = await sharp(f)
          .resize({
            width: maxEdge,
            height: maxEdge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 60 })
          .toBuffer();
        return buf.toString("base64");
      } catch {
        return "";
      }
    }),
  );
  return out.filter(Boolean);
}

async function processFrame(buf: Buffer, opts: SampleOptions): Promise<Buffer> {
  const { compress = false, cropRect } = opts;
  let img = sharp(buf);

  if (cropRect) {
    const meta = await sharp(buf).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (W && H) {
      const [x1, y1, x2, y2] = cropRect;
      const left = clamp(Math.round(x1 * W), 0, W - 1);
      const top = clamp(Math.round(y1 * H), 0, H - 1);
      const width = clamp(Math.round((x2 - x1) * W), 1, W - left);
      const height = clamp(Math.round((y2 - y1) * H), 1, H - top);
      img = sharp(buf).extract({ left, top, width, height });
    }
  }

  img = img.resize({
    width: compress ? 640 : 1280,
    height: compress ? 640 : 1280,
    fit: "inside",
    withoutEnlargement: true,
  });

  return img.jpeg({ quality: 85 }).toBuffer();
}

// ── window samplers ──────────────────────────────────────────────────────────

/** Random input seeks avoid decoding an entire long video for a sparse overview. */
export async function sampleVideoOverviewFast(
  videoPath: string,
  duration: number,
  count: number,
  opts: SampleOptions = {},
): Promise<Buffer[]> {
  const samples = Math.max(1, Math.min(9, count));
  const times = Array.from({ length: samples }, (_, i) =>
    Math.max(
      0,
      Math.min(
        duration - 0.08,
        duration * (0.02 + (0.93 * i) / Math.max(1, samples - 1)),
      ),
    ),
  );
  const frames = await Promise.all(
    times.map(async (time) => {
      const raw = await limit(() =>
        runFfmpegRaw(
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            time.toFixed(3),
            "-i",
            videoPath,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
          ],
          15000,
        ),
      );
      if (!raw.length) throw new Error("Video overview frame unavailable");
      return processFrame(raw, opts);
    }),
  );
  opts.onSampleTimes?.(times);
  return frames;
}

/** Pipeline sampler: n frames spread across [startS,endS]; optional crop/compress/anchor. */
export async function sampleWindowFrames(
  videoPath: string,
  startS: number,
  endS: number,
  nSamples: number,
  opts: SampleOptions & { anchorFrame?: number } = {},
): Promise<Buffer[]> {
  const info = await probeVideo(videoPath);
  const fps = info.fps;
  const winFrameStart = Math.max(0, Math.floor(startS * fps));
  const winFrameEnd =
    info.totalFrames > 0
      ? Math.min(Math.floor(endS * fps), info.totalFrames - 1)
      : Math.floor(endS * fps);
  if (winFrameEnd < winFrameStart) return [];

  const idxs = evenIndices(winFrameStart, winFrameEnd, nSamples);
  if (opts.anchorFrame !== undefined && idxs.length) {
    let closest = 0;
    for (let i = 1; i < idxs.length; i++) {
      if (
        Math.abs(idxs[i]! - opts.anchorFrame) <
        Math.abs(idxs[closest]! - opts.anchorFrame)
      )
        closest = i;
    }
    idxs[closest] = clamp(opts.anchorFrame, winFrameStart, winFrameEnd);
  }

  const raw = await extractFramesByIndices(videoPath, idxs);
  const out: Buffer[] = [];
  for (const b of raw)
    out.push(
      await processFrame(b, {
        compress: opts.compress,
        cropRect: opts.cropRect,
      }),
    );
  opts.onSampleTimes?.(idxs.slice(0, out.length).map((index) => index / fps));
  return out;
}

/**
 * Fast trailing-window sampler for interactive chat: uses ffmpeg INPUT seeking
 * (`-ss` before `-i`) so decode cost is bounded by the window length, NOT by the
 * window's position in the file. Frame indices are relative to the seek point.
 * Precision is keyframe-approximate (fine for conversational context); use the
 * exact `sampleWindowFrames` for the offline analysis pipeline.
 */
export async function sampleWindowFramesFast(
  videoPath: string,
  startS: number,
  endS: number,
  nSamples: number,
  opts: SampleOptions = {},
): Promise<Buffer[]> {
  const info = await probeVideo(videoPath);
  const fps = Math.max(25, Math.min(60, info.fps || 25));
  // A small CFR pre-roll includes the frame already held at a fractional seek
  // point. Without it, 29.97fps files can omit the first requested context view.
  const seekStart = Math.max(0, startS - (info.variableFrameRate || info.fps < 1 ? 8 : 1));
  const offset = startS - seekStart;
  const dur = Math.max(0, endS - startS);
  const framesInWin = Math.max(1, Math.round(dur * fps));
  const preferred = windowSampleIndices(framesInWin, fps, nSamples, opts.recentMotion);
  if (!preferred.length) return [];
  // Uniform sampling can miss a short contact/lift between widely spaced older
  // views. A bounded, inexpensive candidate grid retains those action states,
  // while the model still receives no more than its original image budget.
  const adaptive = opts.recentMotion && nSamples >= 6 && dur >= 3;
  const rel = adaptive
    ? [...new Set([...preferred, ...evenIndices(0, framesInWin - 1,
      Math.min(25, Math.ceil(dur * 3) + 1))])].sort((a, b) => a - b)
    : preferred;

  // Select by displayed time, not decoded-frame number: uneven frame cadence
  // otherwise omits the latest view. Repeated held frames keep identical hashes
  // and therefore cannot create independent completion votes.
  const extract = async (indices: number[], preview = false) => {
    const sel = indices.map((i) => `eq(round((t-${offset})*${fps})\\,${i})`).join("+");
    const args = [
      "-hide_banner",
      "-loglevel",
      "info",
      "-ss",
      seekStart.toFixed(3),
      "-i",
      videoPath,
      "-t",
      (endS - seekStart + 0.5).toFixed(3),
      "-vf",
      `fps=fps=${fps}:round=up,select='${sel}',showinfo${preview ? ',scale=192:144:force_original_aspect_ratio=decrease' : ''}`,
      "-fps_mode",
      "passthrough",
      "-frames:v",
      String(indices.length),
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-q:v",
      "2",
      "pipe:1",
    ];
    let selectedTimes: number[] = [];
    const out = await limit(() =>
      runFfmpegRaw(args, 120000, (diagnostics) => {
        selectedTimes = [...diagnostics.matchAll(/\bpts_time:([\d.eE+-]+)/g)].map(
          (match) => seekStart + Number(match[1]),
        );
      }),
    );
    return { decoded: splitJpegs(out), selectedTimes };
  };
  // At high resolutions, scoring tiny previews before extracting chosen full
  // images is faster than JPEG-encoding every candidate at 1080p. Both passes
  // seek/decode only this bounded trailing window; selected timestamps match.
  const preview = Boolean(adaptive && Math.max(info.width, info.height) > 640);
  const { decoded, selectedTimes } = await extract(rel, preview);
  const usable: Buffer[] = [];
  const candidateTimes: number[] = [];
  for (const [index, b] of decoded.entries()) {
    const time = selectedTimes[index] ?? startS + (rel[index] || 0) / fps;
    if (!Number.isFinite(time) || time < startS - 0.001 || time > endS + 0.05) continue;
    usable.push(b);
    candidateTimes.push(time);
  }
  // Fallback: if fast seek yielded nothing (rare container quirk), use exact path.
  if (!usable.length)
    return sampleWindowFrames(videoPath, startS, endS, nSamples, opts);
  const selected = adaptive
    ? await chooseMotionFrames(usable, candidateTimes,
      preferred.map(index => startS + index / fps), Math.min(9, nSamples), opts.cropRect)
    : usable.map((_, index) => index);
  let chosen = selected.map(index => usable[index]!);
  let times = selected.map(index => candidateTimes[index]!);
  if (preview) {
    const full = await extract(times.map(time => Math.round((time - startS) * fps)));
    const valid = full.decoded.map((frame, index) =>
      ({ frame, time: full.selectedTimes[index] ?? times[index]! }))
      .filter(({ time }) => Number.isFinite(time) && time >= startS - 0.001 && time <= endS + 0.05);
    if (!valid.length) return sampleWindowFrames(videoPath, startS, endS, nSamples, opts);
    chosen = valid.map(({ frame }) => frame);
    times = valid.map(({ time }) => time);
  }
  const result = await Promise.all(chosen.map(frame => processFrame(frame, opts)));
  opts.onSampleTimes?.(times);
  return result;
}

/** Ask-AI trailing-window sampler (port _sample_from_file): long-edge 640, no compress. */
export async function sampleFromWindow(
  videoPath: string,
  currentS: number,
  chunkSecs: number,
  nSamples: number,
): Promise<Buffer[]> {
  const info = await probeVideo(videoPath);
  const fps = info.fps;
  const endS = Math.max(0.5, currentS);
  const startS = Math.max(0, endS - chunkSecs);
  const sf = Math.max(0, Math.floor(startS * fps));
  const ef =
    info.totalFrames > 0
      ? Math.min(Math.floor(endS * fps), info.totalFrames - 1)
      : Math.floor(endS * fps);
  if (ef < sf) return [];

  const idxs = evenIndices(sf, ef, nSamples);
  const raw = await extractFramesByIndices(videoPath, idxs);
  const out: Buffer[] = [];
  for (const b of raw) out.push(await processFrame(b, { compress: false }));
  return out;
}

// ── mosaics ──────────────────────────────────────────────────────────────────

/** N×N grid, row-major, oldest top-left → newest bottom-right; each tile tilePx². */
export async function buildMosaic(
  frames: Buffer[],
  n: number,
  tilePx: number,
): Promise<Buffer> {
  const chosen = frames.slice(-n * n);
  const tiles = await Promise.all(
    chosen.map((f) =>
      sharp(f)
        .resize(tilePx, tilePx, { fit: "contain", background: "black" })
        .toBuffer(),
    ),
  );
  const composites = tiles.map((input, i) => ({
    input,
    left: (i % n) * tilePx,
    top: Math.floor(i / n) * tilePx,
  }));
  return sharp({
    create: {
      width: n * tilePx,
      height: n * tilePx,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** ceil(sqrt(N)) columns; tile size = first frame's dimensions (port _build_mosaic). */
export async function buildSquareMosaic(frames: Buffer[]): Promise<Buffer> {
  if (!frames.length) {
    return sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();
  }
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  const meta = await sharp(frames[0]!).metadata();
  const w = meta.width ?? 640;
  const h = meta.height ?? 640;
  const tiles = await Promise.all(
    frames.map((f) => sharp(f).resize(w, h, { fit: "fill" }).toBuffer()),
  );
  const composites = tiles.map((input, i) => ({
    input,
    left: (i % cols) * w,
    top: Math.floor(i / cols) * h,
  }));
  return sharp({
    create: {
      width: cols * w,
      height: rows * h,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite(composites)
    .jpeg({ quality: 85 })
    .toBuffer();
}

// ── whole-video clip (Gemini path) ───────────────────────────────────────────

/** Cut [startS,endS] to a temp mp4 (stream copy, libx264 fallback). Caller deletes it. */
export async function extractClip(
  videoPath: string,
  startS: number,
  endS: number,
): Promise<string> {
  const tmp = path.join(
    os.tmpdir(),
    `clip_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
  );
  const dur = Math.max(0.1, endS - startS);
  try {
    await limit(() =>
      runFfmpegFile([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        startS.toFixed(3),
        "-i",
        videoPath,
        "-t",
        dur.toFixed(3),
        "-c",
        "copy",
        tmp,
      ]),
    );
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) return tmp;
  } catch {
    /* fall through to re-encode */
  }
  await limit(() =>
    runFfmpegFile([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startS.toFixed(3),
      "-i",
      videoPath,
      "-t",
      dur.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-an",
      tmp,
    ]),
  );
  return tmp;
}
