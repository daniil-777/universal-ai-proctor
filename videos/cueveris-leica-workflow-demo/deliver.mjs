import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const project = path.dirname(fileURLToPath(import.meta.url));
const delivery = path.resolve(project, '../../frontend/public/media');
const qa = path.join(project, 'qa');
const stem = 'cueveris-leica-workflow-demo';
const output = path.join(delivery, `${stem}.mp4`);
const poster = path.join(delivery, `${stem}.jpg`);
const data = JSON.parse(await fs.readFile(path.join(project, 'public/demo-data.json'), 'utf8'));
const run = (program, args) => execFileSync(program, args, {encoding: 'utf8', maxBuffer: 16*1024*1024});
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
await fs.mkdir(delivery, {recursive: true});
await fs.mkdir(qa, {recursive: true});

const slots = [
  {key: 'opening', duration: 6},
  {key: 'setup', duration: 7},
  ...data.questions.map(question => ({key: question.key, duration: Math.max(14, question.voice_duration_seconds+2.25), question})),
  {key: 'review', duration: 7},
  {key: 'closing', duration: 4},
];
let currentFrame = 0;
const scenes = slots.map((slot, index) => {
  const frames = Math.ceil(slot.duration*30);
  const scene = {...slot, start_frame: currentFrame, duration_frames: frames};
  currentFrame += frames-(index < slots.length-1 ? 15 : 0);
  return scene;
});
const expectedFrames = currentFrame;

// The screenshot-rendered master is full range. Explicit luminance conversion
// avoids describing full-range video as a limited-range YUV420p delivery.
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(project, 'out/master.mp4'), '-vf', 'scale=in_range=full:out_range=limited,format=yuv420p', '-c:v', 'libx264', '-crf', '22', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-metadata', 'title=Cueveris — Leica M10 guided study', '-metadata', 'comment=Actual Cueveris UI, original document and app-produced voice. Document-based text context only. No Leica footage, source audio or source frames incorporated.', output]);
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(project, 'out/poster.png'), '-frames:v', '1', '-q:v', '3', poster]);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', output, '-f', 'null', '-']);
const video = probe.streams.find(s => s.codec_type === 'video');
const audio = probe.streams.filter(s => s.codec_type === 'audio');
if (video.codec_name !== 'h264' || video.width !== 1440 || video.height !== 900 || video.pix_fmt !== 'yuv420p' || video.avg_frame_rate !== '30/1' || Number(video.nb_frames) !== expectedFrames || audio.length !== 1 || audio[0].codec_name !== 'aac') throw new Error('Delivery does not match the video/audio contract.');
const measuredDuration = Number(probe.format.duration);
if (Math.abs(measuredDuration-expectedFrames/30) > .07) throw new Error('Unexpected video duration.');

const bytes = await fs.readFile(output);
const atoms = [];
let offset = 0;
while (offset+8 <= bytes.length) {
  const length = bytes.readUInt32BE(offset);
  const type = bytes.toString('ascii', offset+4, offset+8);
  const size = length === 1 ? Number(bytes.readBigUInt64BE(offset+8)) : length || bytes.length-offset;
  atoms.push({type, offset, bytes: size});
  if (size <= 0) break;
  offset += size;
}
const faststart = atoms.find(a => a.type === 'moov')?.offset < atoms.find(a => a.type === 'mdat')?.offset;
if (!faststart) throw new Error('MP4 is missing faststart.');

const peakResult = spawnSync('ffmpeg', ['-hide_banner', '-i', output, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '-'], {encoding: 'utf8'});
const peakDbfs = Number(peakResult.stderr.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);
if (peakResult.status !== 0 || !Number.isFinite(peakDbfs) || peakDbfs >= 0) throw new Error('Audio peak check failed.');
const samples = scenes.map(scene => Math.min((scene.start_frame+60)/30, (scene.start_frame+scene.duration_frames-1)/30));
for (const [index, time] of samples.entries()) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', output, '-frames:v', '1', '-q:v', '2', path.join(qa, `frame-${String(index).padStart(2, '0')}.jpg`)]);
}
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(qa, 'frame-%02d.jpg'), '-vf', 'scale=480:300,tile=4x2', '-frames:v', '1', '-q:v', '2', path.join(qa, 'contact-sheet.jpg')]);

const stamp = seconds => {
  const ms = Math.round(seconds*1000);
  return `${String(Math.floor(ms/3600000)).padStart(2, '0')}:${String(Math.floor(ms/60000)%60).padStart(2, '0')}:${String(Math.floor(ms/1000)%60).padStart(2, '0')}.${String(ms%1000).padStart(3, '0')}`;
};
const captions = scenes.filter(s => s.question).map((scene, index) => `${index+1}\n${stamp(scene.start_frame/30+1)} --> ${stamp(scene.start_frame/30+1+scene.question.voice_duration_seconds)}\n${scene.question.spoken_text}\n`);
await fs.writeFile(path.join(delivery, `${stem}.vtt`), 'WEBVTT\n\n'+captions.join('\n'));
const sources = ['demo-data.json', data.guide_panel_file, data.setup_panel_file, data.review_panel_file, 'inter.ttf', 'INTER-LICENSE.txt', ...data.questions.flatMap(q => [q.app_panel_file, q.voice_file])];
const sourceAssets = [];
for (const filename of [...new Set(sources)]) {
  const content = await fs.readFile(path.join(project, 'public', filename));
  sourceAssets.push({file: `public/${filename}`, bytes: content.length, sha256: sha256(content)});
}
const credits = {
  title: 'Cueveris — Leica M10 guided film study',
  duration_seconds: expectedFrames/30,
  width: 1440,
  height: 900,
  fps: 30,
  asset: `/media/${stem}.mp4`,
  poster: `/media/${stem}.jpg`,
  captions: `/media/${stem}.vtt`,
  mode: 'Document-based reference questions + original guide; text-only app answers and app-generated voice',
  visual_analysis_calls: 0,
  image_frames_submitted: 0,
  manual_confirmations: 0,
  confirmed_steps: data.report.confirmed_steps,
  guide_steps: data.report.total_steps,
  selected_questions: data.questions.length,
  source_film: {
    title: 'A masterpiece in the making – your Leica M10.',
    publisher: 'Leica Camera',
    url: 'https://www.youtube.com/watch?v=p4t-OVIvuy8',
    usage: 'Official source film remains separately embedded on the webpage. No source pixels, extracted frames, thumbnails, film audio or downloaded stream are included in this movie.',
    affiliation: 'Independent guided study. Leica Camera does not endorse Cueveris.',
  },
  UI_and_document: 'Original Cueveris product interface and observation guide',
  guide_filename: data.guide_filename,
  guide_digest: data.guide_digest,
  capture_date: data.recorded_at,
  voice: 'AI-generated app speech, using the exact labelled response excerpts. Same production endpoint and identical text were retried where browser instrumentation did not expose the original response body.',
  font: {name: 'Inter', license: 'SIL Open Font License 1.1', license_file: 'public/INTER-LICENSE.txt'},
  source_assets: sourceAssets,
  questions: data.questions.map(q => ({key: q.key, question: q.question, answer: q.answer, spoken_text: q.spoken_text, spoken_excerpt: q.spoken_excerpt, voice_seconds: q.voice_duration_seconds, guide_reference: q.guide_stage_label})),
};
const creditText = `CUEVERIS — LEICA M10 GUIDED FILM STUDY\n\nThis movie contains the original Cueveris interface, an original six-step observation guide, genuine production-app text answers and app-generated spoken answer excerpts. The examples are document-based reference questions, not claims that an operator actually observed film scenes. No Leica film images are submitted for visual analysis; no Leica pixels, frames, thumbnails, film audio or downloaded video are incorporated. The film does not demonstrate automated recognition of Leica footage, factory inspection, hidden tolerance checks or a passed camera. Six steps remain unconfirmed.\n\nOfficial viewing reference: A masterpiece in the making – your Leica M10., published by Leica Camera.\n${credits.source_film.url}\nThe untouched official player remains separately available on the webpage. Independent study; no Leica affiliation or endorsement.\n\nVoice: AI-generated product speech from the actual app's production speech endpoint. Complete-sentence answer excerpts are labelled. Where browser instrumentation returned no response bytes, the same production endpoint generated an identical-text retry; this provenance is preserved in the project's capture audit. No music or Leica film audio.\n\nTypeface: Inter, SIL Open Font License 1.1; see public/INTER-LICENSE.txt in the editable project. Product UI, guide and film composition: Cueveris project.\n\nEditable source: guidance-app/videos/cueveris-leica-workflow-demo. Rendering makes no model calls. Companion JSON includes exact questions, answers, speech text, source-asset hashes and guide provenance.\n`;
await fs.writeFile(path.join(delivery, `${stem}.json`), JSON.stringify(credits, null, 2)+'\n');
await fs.writeFile(path.join(delivery, `${stem}.txt`), creditText);
await fs.writeFile(path.join(project, 'CREDITS.txt'), creditText);
await fs.writeFile(path.join(qa, 'timeline.json'), JSON.stringify(scenes, null, 2)+'\n');
await fs.writeFile(path.join(qa, 'source-assets.json'), JSON.stringify(sourceAssets, null, 2)+'\n');
await fs.writeFile(path.join(qa, 'delivery-qa.json'), JSON.stringify({checked_at: new Date().toISOString(), passed: true, codec: video.codec_name, pixel_format: video.pix_fmt, width: video.width, height: video.height, fps: video.avg_frame_rate, frames: Number(video.nb_frames), duration_seconds: measuredDuration, audio_codec: audio[0].codec_name, audio_sample_rate: audio[0].sample_rate, audio_peak_dbfs: peakDbfs, bytes: bytes.length, sha256: sha256(bytes), full_decode_without_errors: true, mp4_faststart: faststart, mp4_atoms: atoms, sampled_seconds: samples, visual_review: 'Pending final visual inspection'}, null, 2)+'\n');
console.log(JSON.stringify({output, poster, bytes: bytes.length, duration: expectedFrames/30, full_decode: true, faststart}));
