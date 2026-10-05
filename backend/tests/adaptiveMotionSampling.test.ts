import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {describe, it, expect} from 'vitest';
import {sampleWindowFramesFast, windowSampleIndices} from '../src/pipeline/frames.js';

describe('adaptive trailing motion evidence', () => {
  it('retains a short visible action missed by regular context spacing, with fresh held views and bounded images', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proctor-motion-'));
    try {
      const video = path.join(dir, 'short-action.mp4');
      execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:size=160x120:rate=30:duration=9',
        '-vf', "drawbox=x=40:y=30:w=80:h=60:color=white:t=fill:enable='between(t,3.9,4.1)'",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'});
      // The original nine-image recent-motion schedule contains no action view.
      expect(windowSampleIndices(240, 30, 9, true)
        .some(index => index / 30 >= 3.9 && index / 30 <= 4.1)).toBe(false);
      let times: number[] = [];
      const frames = await sampleWindowFramesFast(video, 0, 8, 9,
        {recentMotion: true, onSampleTimes: value => times = value});
      expect(frames.length).toBeLessThanOrEqual(9);
      expect(times).toHaveLength(frames.length);
      expect(times.every((time, i) => time >= 0 && time <= 8 && (i === 0 || time > times[i - 1]!))).toBe(true);
      expect(times.some(time => time >= 3.9 && time <= 4.1)).toBe(true);
      for (const [i, expected] of [7.16667, 7.56667, 7.96667].entries())
        expect(times.slice(-3)[i]).toBeCloseTo(expected, 4);
      const means = await Promise.all(frames.map(async frame => (await sharp(frame).stats()).channels[0]!.mean));
      expect(Math.max(...means)).toBeGreaterThan(50);
      const hash = (frame: Buffer) => createHash('sha256').update(frame).digest('hex');
      expect(new Set(frames.slice(-3).map(hash)).size).toBe(1);
      // Extra repeated held views do not use the remaining image budget.
      expect(frames.length).toBe(6);
      const cropped = await sampleWindowFramesFast(video, 0, 8, 9,
        {recentMotion: true, cropRect: [0, 0, 0.2, 1]});
      expect(cropped).toHaveLength(5);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
  }, 15000);

  it('preserves all requested CFR views after a fractional seek and returns full-resolution adaptive evidence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proctor-fractional-'));
    try {
      const video = path.join(dir, 'fractional.mp4');
      execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:size=720x480:rate=30000/1001:duration=9',
        '-vf', "drawbox=x=180:y=120:w=360:h=240:color=white:t=fill:enable='between(t,3.9,4.1)'",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'});
      let regularTimes: number[] = [];
      const regular = await sampleWindowFramesFast(video, 1, 8, 9,
        {onSampleTimes: value => regularTimes = value});
      expect(regular).toHaveLength(9);
      expect(regularTimes[0]).toBeGreaterThanOrEqual(1);
      expect(regularTimes[0]).toBeLessThan(1.05);
      let times: number[] = [];
      const adaptive = await sampleWindowFramesFast(video, 1, 8, 9,
        {recentMotion: true, onSampleTimes: value => times = value});
      expect(times).toHaveLength(adaptive.length);
      expect(times.some(time => time >= 3.9 && time <= 4.1)).toBe(true);
      expect(times.every(time => time >= 1 && time <= 8.05)).toBe(true);
      for (const image of adaptive) {
        const metadata = await sharp(image).metadata();
        expect(metadata.width).toBe(720);
        expect(metadata.height).toBe(480);
      }
      const hash = (frame: Buffer) => createHash('sha256').update(frame).digest('hex');
      expect(new Set(adaptive.slice(-3).map(hash)).size).toBe(1);
      expect(hash(adaptive.at(-1)!)).toBe(hash(regular.at(-1)!));
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
  }, 20000);

  it('keeps a brief current-shot action after a cut despite visually busy older scenes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'proctor-shot-bridge-'));
    try {
      const video = path.join(dir, 'cut-action.mp4');
      execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=30:duration=9',
        '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=gray:t=fill:enable='gte(t,7)',drawbox=x=80:y=60:w=20:h=20:color=white:t=fill:enable='between(t,7.09,7.15)'",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'});
      let times: number[] = [];
      const frames = await sampleWindowFramesFast(video, 0, 8, 9,
        {recentMotion: true, onSampleTimes: value => times = value});
      expect(frames.length).toBeLessThanOrEqual(9);
      expect(times).toHaveLength(frames.length);
      const actionIndex = times.findIndex(time => time >= 7.09 && time <= 7.15);
      expect(actionIndex).toBeGreaterThanOrEqual(0);
      const patchStats = async (frame: Buffer) => sharp(await sharp(frame)
        .extract({left: 80, top: 60, width: 20, height: 20}).toBuffer()).stats();
      const action = await patchStats(frames[actionIndex]!);
      const latest = await patchStats(frames.at(-1)!);
      expect(action.channels[0]!.mean).toBeGreaterThan(220);
      expect(latest.channels[0]!.mean).toBeLessThan(150);
      expect(times.at(-1)).toBeGreaterThan(7.9);
      expect(times.every(time => time >= 0 && time <= 8)).toBe(true);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
  }, 15000);
});
