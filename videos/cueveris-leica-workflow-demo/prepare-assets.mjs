import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const project = path.dirname(fileURLToPath(import.meta.url));
const captureDir = process.argv[2] || '/private/tmp/cueveris-leica-ui-capture-approved';
const capture = JSON.parse(await fs.readFile(path.join(captureDir, 'capture-results.json'), 'utf8'));
if (capture.mock !== false || capture.manual_confirmations !== 0 || capture.visual_analysis_calls !== 0 || capture.results.length !== 3) throw new Error('Capture does not match the text-only production protocol.');
const stages = capture.workflow.stages;
if (stages.length !== 6 || stages.some(s => s.complete || s.criteria.some(c => c.status !== 'unknown'))) throw new Error('All six stages and their hidden criteria must remain unconfirmed.');
const pub = path.join(project, 'public');
await fs.mkdir(pub, {recursive: true});
const crop = (file, target, rectangle) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(captureDir, file), '-vf', `crop=${rectangle.width}:${rectangle.height}:${rectangle.x}:${rectangle.y}`, '-frames:v', '1', path.join(pub, target)]);

// Only our actual interface regions enter the project. No source-player image,
// replay thumbnail, screenshot of film content or original film audio is used.
crop('six-checkpoints.png', 'six-checkpoints-panel.png', {x: 1453, y: 205, width: 455, height: 830});
crop('guide-loaded.png', 'study-header-panel.png', {x: 385, y: 73, width: 1054, height: 256});
crop('guide-loaded.png', 'mechanics-guide-panel.png', {x: 1453, y: 205, width: 455, height: 700});
const configurations = [
  {key: 'mechanics', title: 'Camera-body mechanics.', topic: 'Camera-body and mechanical assembly', guide: 'S1 · mechanical assembly', voice: 'voice-03.mp3', crop: {x: 1480, y: 158, width: 440, height: 286}},
  {key: 'sensor', title: 'Sensor-surface handling.', topic: 'Sensor-like rectangular optical surface', guide: 'S3 · sensor-surface handling', voice: 'voice-05.mp3', crop: {x: 1480, y: 442, width: 440, height: 278}},
  {key: 'closure', title: 'Enclosure closure.', topic: 'Alignment and fitting of the outer cover', guide: 'S5 · enclosure closure', voice: 'voice-07.mp3', crop: {x: 1480, y: 615, width: 440, height: 210}},
];
const auditQuestions = [];
const questions = [];
for (const item of configurations) {
  const result = capture.results.find(r => r.key === item.key);
  const voice = capture.voice.find(v => v.file === item.voice);
  if (result.actual_response_status !== 200 || result.frames !== 0 || result.request.frames_b64.length || result.request.frame_times_s.length) throw new Error('Every demonstration answer must be an actual successful request without image frames.');
  if (!voice || voice.actual_ui_request !== true || voice.status !== 200 || voice.retry_status !== 200 || !result.answer.includes(voice.text)) throw new Error('Voice must match an actual UI-generated answer excerpt.');
  const voiceFile = `voice-${item.key}.mp3`;
  const voiceBytes = await fs.readFile(path.join(captureDir, voice.file));
  await fs.writeFile(path.join(pub, voiceFile), voiceBytes);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', path.join(pub, voiceFile)], {encoding: 'utf8'}));
  const duration = Number(probe.format.duration);
  if (Math.abs(duration-voice.duration_s) > .05) throw new Error('Delivered voice duration differs from capture metadata.');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', path.join(pub, voiceFile), '-f', 'null', '-']);
  const panelFile = `${item.key}-qa-panel.png`;
  crop(`${item.key}-qa.png`, panelFile, item.crop);
  questions.push({key: item.key, title: item.title, reference_topic: item.topic, question: result.text, answer: result.answer, spoken_text: voice.text, spoken_excerpt: true, voice_file: voiceFile, voice_duration_seconds: duration, app_panel_file: panelFile, guide_stage_label: item.guide});
  auditQuestions.push({key: item.key, provider: result.request.provider, model: result.request.model_id, actual_response_status: result.actual_response_status, image_frames: 0, exact_question: result.text, exact_answer: result.answer, voice_file: voiceFile, voice_duration_seconds: duration, voice_sha256: createHash('sha256').update(voiceBytes).digest('hex'), spoken_excerpt: true, exact_spoken_text: voice.text, actual_ui_speech_request: true, speech_retry_reason: voice.retry_reason, speech_retry_status: voice.retry_status, crop: item.crop});
}
const data = {title: 'Leica M10 assembly study', recorded_at: capture.finished_at, guide_filename: capture.workflow.filename, guide_digest: capture.workflow.reference_key, guide_panel_file: 'six-checkpoints-panel.png', setup_panel_file: 'study-header-panel.png', review_panel_file: 'six-checkpoints-panel.png', guide_titles: stages.map(s => s.name), protocol: {mode: 'document_based_text_questions', frames_submitted: 0, simulated: false, source_film_downloaded: false}, questions, report: {text_questions: 3, visual_analyses: 0, confirmed_steps: 0, total_steps: 6, title: 'Guide checkpoints remain unconfirmed'}};
await fs.writeFile(path.join(pub, 'demo-data.json'), JSON.stringify(data, null, 2)+'\n');
const sourceAudit = {recorded_at: capture.finished_at, passed: true, protocol: 'Actual Leica-specific document Q&A; reference-only questions; no image frames, source-film download, visual analysis or manual confirmation.', production: true, mock: false, visual_analysis_calls: 0, manual_confirmations: 0, workflow: {stages: 6, confirmed: 0, criteria: stages.reduce((n,s) => n+s.criteria.length, 0), unknown_criteria: stages.reduce((n,s) => n+s.criteria.filter(c => c.status === 'unknown').length, 0)}, questions: auditQuestions};
await fs.mkdir(path.join(project, 'qa'), {recursive: true});
await fs.writeFile(path.join(project, 'qa/source-capture-audit.json'), JSON.stringify(sourceAudit, null, 2)+'\n');
console.log(JSON.stringify({prepared: true,questions: questions.length,frames: 0,steps_confirmed: 0,spoken_seconds: questions.map(q => q.voice_duration_seconds)}));
