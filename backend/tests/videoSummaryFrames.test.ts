import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { sampleVideoSummaryFrames } from "../src/pipeline/videoSummaryFrames.js";

const video = path.resolve("../evaluation/assets/parts-sorting.mp4");
let directory: string;
beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "summary-portrait-decoder-")); });
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
describe("abortable timestamped recap decoder", () => {
  it("retains actual source timestamps after seeking and never upscales original source pixels", async () => {
    const frames = await sampleVideoSummaryFrames({ path: video, start_s: 12, end_s: 16, count: 3, signal: new AbortController().signal });
    expect(frames).toHaveLength(3); expect(frames.map(f => f.time_s)).toEqual([12.75, 14, 15.5]);
    const metadata = await sharp(frames[0]!.buffer).metadata(); expect([metadata.width, metadata.height]).toEqual([960, 640]);
    expect(frames.every(frame => frame.buffer.length > 1000 && frame.time_s >= 12 && frame.time_s <= 16)).toBe(true);
  });
  it("rejects an already cancelled read without launching decoding", async () => {
    const signal = AbortSignal.abort(new Error("stop decoder"));
    await expect(sampleVideoSummaryFrames({ path: video, start_s: 0, end_s: 6, count: 6, signal })).rejects.toThrow("stop decoder");
  });
  it("bounds frame counts and rejects invalid source intervals", async () => {
    await expect(sampleVideoSummaryFrames({ path: video, start_s: 6, end_s: 1, count: 3, signal: new AbortController().signal })).rejects.toThrow("Invalid sampling interval");
    const frames = await sampleVideoSummaryFrames({ path: video, start_s: 0, end_s: 6, count: 99, signal: new AbortController().signal }); expect(frames).toHaveLength(9);
  });
  it("reports genuine decode failures rather than manufacturing empty successful evidence", async () => {
    await expect(sampleVideoSummaryFrames({ path: "/private/tmp/missing-summary-source.mp4", start_s: 0, end_s: 6, count: 3, signal: new AbortController().signal })).rejects.toThrow("Could not decode");
  });
  it("caps both dimensions of a tall portrait source and retains its top and bottom without cropping", async () => {
    const staticPath = ffmpegStatic as unknown as string | null;
    const executable = process.env.FFMPEG_PATH || (staticPath && fs.existsSync(staticPath) ? staticPath : "ffmpeg");
    const file = path.join(directory, "portrait-720x2160.mp4");
    await promisify(execFile)(executable, ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=0x00cccc:s=720x2160:r=2:d=1,drawbox=x=0:y=0:w=iw:h=ih/4:color=red:t=fill,drawbox=x=0:y=ih*3/4:w=iw:h=ih/4:color=blue:t=fill", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-y", file]);
    const frames = await sampleVideoSummaryFrames({ path: file, start_s: 0, end_s: 1, count: 1, signal: new AbortController().signal });
    const image = sharp(frames[0]!.buffer), metadata = await image.metadata();
    expect(metadata.width).toBeLessThanOrEqual(720); expect(metadata.width).toBeLessThanOrEqual(1280); expect(metadata.height).toBe(1280);
    expect(metadata.width! / metadata.height!).toBeCloseTo(720 / 2160, 2);
    const top = await image.clone().extract({ left: 20, top: 20, width: 1, height: 1 }).raw().toBuffer();
    const bottom = await image.clone().extract({ left: 20, top: metadata.height! - 20, width: 1, height: 1 }).raw().toBuffer();
    expect(top[0]).toBeGreaterThan(180); expect(top[2]).toBeLessThan(50); expect(bottom[2]).toBeGreaterThan(180); expect(bottom[0]).toBeLessThan(50);
    const small = await sampleVideoSummaryFrames({ path: path.resolve("../evaluation/assets/packaging-portrait.mp4"), start_s: 0, end_s: 2, count: 1, signal: new AbortController().signal });
    const smallMetadata = await sharp(small[0]!.buffer).metadata(); expect([smallMetadata.width, smallMetadata.height]).toEqual([480, 800]);
  });
});
