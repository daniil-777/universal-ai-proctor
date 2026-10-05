import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sampleWindowFramesFast } from '../../backend/dist/pipeline/frames.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback) => {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing value for ${key}`);
  return args[index + 1];
};
const bankFile = option('--bank', 'qa/recognition-question-bank.json');
const outputFile = option('--output', 'qa/adaptive-v1-frame-pack.json');
const windowSeconds = Number(option('--window', '8'));
const samples = Number(option('--samples', '9'));
if (!/^qa\/(?:adaptive|refined)-[a-z0-9-]+-frame-pack\.json$/.test(outputFile)) {
  throw Error('Output must be a NEW qa/adaptive-*-frame-pack.json or qa/refined-*-frame-pack.json');
}
if (!Number.isFinite(windowSeconds) || windowSeconds < 3 || windowSeconds > 30) throw Error('Window must be 3..30 seconds');
if (!Number.isInteger(samples) || samples < 6 || samples > 9) throw Error('Adaptive samples must be 6..9');
const relativePath = value => {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw Error(`Invalid relative path: ${value}`);
  return path.join(root, value);
};
const exists = async file => {
  try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileDigest = async file => {
  const hasher = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hasher.update(chunk);
  return hasher.digest('hex');
};
const output = relativePath(outputFile);
const packName = path.basename(outputFile, '-frame-pack.json');
const imageRootRelative = `qa/adaptive-frame-packs/${packName}`;
const imageRoot = relativePath(imageRootRelative);
if (await exists(output) || await exists(imageRoot)) throw Error('Refusing to overwrite an existing pack or image directory');

const bankBytes = await fs.readFile(relativePath(bankFile));
const bank = JSON.parse(bankBytes);
if (!Array.isArray(bank.cases) || bank.cases.length !== 42
  || bank.cases.filter(row => row.channel === 'stage').length !== 32
  || bank.cases.filter(row => row.channel === 'uncertainty').length !== 10) {
  throw Error('The unchanged full bank must contain 32 stage cases and 10 uncertainty questions');
}
if (new Set(bank.cases.map(row => row.id)).size !== bank.cases.length) throw Error('Duplicate case IDs');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const samplerFile = path.resolve(root, '../../backend/dist/pipeline/frames.js');
const samplerBytes = await fs.readFile(samplerFile);
if (!samplerBytes.toString().includes('chooseMotionFrames')) throw Error('Adaptive production sampler has not been built');
const samplesById = new Map();
for (const scenario of manifest.scenarios) {
  const actual = await fileDigest(relativePath(scenario.video));
  if (actual !== scenario.sha256) throw Error(`Source hash mismatch: ${scenario.id}`);
  samplesById.set(scenario.id, scenario);
}

const temporaryImageRoot = `${imageRoot}.tmp-${process.pid}`;
await fs.mkdir(temporaryImageRoot, { recursive: true });
const rows = [];
try {
  for (const entry of bank.cases) {
    if (!/^[a-z0-9-]+$/.test(entry.id)) throw Error(`Invalid case ID: ${entry.id}`);
    const scenario = samplesById.get(entry.scenario_id);
    if (!scenario) throw Error(`Unknown scenario: ${entry.scenario_id}`);
    const currentS = entry.timestamp_s;
    if (!Number.isFinite(currentS) || currentS < 0 || currentS > scenario.duration_s) throw Error(`Invalid case time: ${entry.id}`);
    const times = [];
    const started = performance.now();
    const frames = await sampleWindowFramesFast(
      relativePath(scenario.video), Math.max(0, currentS - windowSeconds), currentS, samples,
      { compress: false, recentMotion: true, onSampleTimes: selected => times.push(...selected) },
    );
    if (!frames.length || frames.length > samples || frames.length !== times.length) throw Error(`Missing/oversized frames: ${entry.id}`);
    const files = [];
    for (const [index, bytes] of frames.entries()) {
      const time = times[index];
      if (!Number.isFinite(time) || time < Math.max(0, currentS - windowSeconds) - 0.001
        || time > currentS + 0.001 || (index > 0 && time < times[index - 1])) {
        throw Error(`Unordered or future frame: ${entry.id} (${time} > ${currentS})`);
      }
      const filename = `${entry.id}-${index}.jpg`;
      const temporaryFile = path.join(temporaryImageRoot, filename);
      await fs.writeFile(temporaryFile, bytes);
      const sha256 = digest(bytes);
      if (await fileDigest(temporaryFile) !== sha256) throw Error(`Written frame hash mismatch: ${entry.id}`);
      files.push({ file: `${imageRootRelative}/${filename}`, sha256, timestamp_s: time });
    }
    const extractionMs = Math.round(performance.now() - started);
    rows.push({ id: entry.id, scenario_id: entry.scenario_id, current_s: currentS, source_sha256: scenario.sha256, frames: files, extraction_ms: extractionMs });
    console.log(JSON.stringify({ case_id: entry.id, frames: frames.length, times, extraction_ms: extractionMs }));
  }
  if (digest(await fs.readFile(relativePath(bankFile))) !== digest(bankBytes)) throw Error('Question bank changed during extraction');
  const pack = {
    version: 1, prepared_at: new Date().toISOString(), bank: bankFile, bank_sha256: digest(bankBytes),
    samples, window_seconds: windowSeconds, latest_motion_seconds: 0.8,
    sampler_sha256: digest(samplerBytes), sampling: 'production-adaptive-motion-salience',
    description: 'Unchanged case times and banks. Production adaptive sampler selects actual trailing-window JPEGs from bounded motion candidates, retaining recent views. Identical hash-verified pixels/timestamps are replayed to all models; no expected IDs or answers enter selection. No future images.',
    cases: rows,
  };
  await fs.rename(temporaryImageRoot, imageRoot);
  await fs.writeFile(`${output}.tmp-${process.pid}`, JSON.stringify(pack, null, 2));
  await fs.rename(`${output}.tmp-${process.pid}`, output);
  console.log(JSON.stringify({ output: outputFile, cases: rows.length, frames: rows.reduce((sum, row) => sum + row.frames.length, 0), bank_sha256: pack.bank_sha256, sampler_sha256: pack.sampler_sha256 }));
} catch (error) {
  await fs.rm(temporaryImageRoot, { recursive: true, force: true });
  throw error;
}
