import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (key, fallback = '') => {
  const index = args.indexOf(key);
  return index < 0 ? fallback : args[index + 1];
};
const inputs = option('--runs').split(',').filter(Boolean);
if (!inputs.length) throw Error('Pass --runs qa/first-results.json,qa/second-results.json');
for (const optional of ['qa/refined-astra-medium-v2-results.json', 'qa/refined-astra-questions-results.json', 'qa/final-phase-gate-smoke-results.json']) {
  try { await fs.access(path.join(root, optional)); if (!inputs.includes(optional)) inputs.push(optional); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const resolve = file => {
  if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) throw Error(`Invalid relative file: ${file}`);
  return path.join(root, file);
};
const quantile = (values, percentile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)] : null;
};
const seconds = milliseconds => milliseconds == null ? '—' : `${(milliseconds / 1000).toFixed(1)}s`;
const rawLink = file => esc(path.relative(path.join(root, 'qa'), resolve(file)).split(path.sep).join('/'));
const baselines = [
  { label: 'Earlier GPT-4o', bank_version: 'Original v1', correct: 18, total: 32, file: 'qa/improved-baseline-results.json' },
  { label: 'Previous Astra', bank_version: 'Original v1', correct: 28, total: 32, file: 'qa/astra-unchanged-v1-results.json' },
  { label: 'Previous Astra', bank_version: 'Revised anchors v2', correct: 31, total: 32, file: 'qa/model-astra-frozen-results.json' },
];
const runSummaries = [];
for (const file of inputs) {
  const bytes = await fs.readFile(resolve(file));
  const data = JSON.parse(bytes);
  const bankBytes = await fs.readFile(resolve(data.bank));
  if (digest(bankBytes) !== data.bank_sha256) throw Error(`Unchanged bank hash mismatch: ${file}`);
  const bank = JSON.parse(bankBytes);
  for (const row of data.results) {
    const reference = bank.cases.find(entry => entry.id === row.id);
    if (!reference || reference.expected_step_id !== row.expected_step_id || reference.timestamp_s !== row.timestamp_s) {
      throw Error(`Altered expected ID or case time: ${file}, ${row.id}`);
    }
  }
  const stage = data.results.filter(row => row.channel === 'stage');
  const rows = stage.map(row => {
    const reference = bank.cases.find(entry => entry.id === row.id);
    if (!reference || reference.expected_step_id !== row.expected_step_id || reference.timestamp_s !== row.timestamp_s) {
      throw Error(`Altered expected ID or case time: ${file}, ${row.id}`);
    }
    const observation = row.guardian?.observation;
    const actual = observation?.current_step_id ?? null;
    const ui = row.guardian?.current_stage_id || null;
    return {
      id: row.id, scenario_id: row.scenario_id, timestamp_s: row.timestamp_s,
      expected_step_id: reference.expected_step_id, observed_step_id: actual, ui_step_id: ui,
      result: row.error ? 'error' : actual === reference.expected_step_id ? 'correct' : actual === null ? 'uncertain' : 'wrong',
      ui_match: !row.error && ui === reference.expected_step_id,
      summary: observation?.summary ?? '', guidance: observation?.guidance ?? '',
      phase_evidence: observation?.phase_evidence ?? null,
      error: row.error ?? null, guardian_latency_ms: row.guardian_latency_ms ?? row.guardian?.ms ?? row.latency_ms ?? null,
      frame_times_s: row.guardian?.frame_times_s ?? [], frame_sha256s: row.frame_sha256s ?? [],
    };
  });
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error(`Duplicate stage case: ${file}`);
  const correct = rows.filter(row => row.result === 'correct').length;
  const latencies = rows.map(row => row.guardian_latency_ms);
  const questions = data.results.filter(row => row.answer || (row.channel === 'uncertainty' && row.error)).map(row => ({
    id: row.id, scenario_id: row.scenario_id, timestamp_s: row.timestamp_s,
    question: row.question, answer: row.answer ?? null, error: row.error ?? null,
    latency_ms: row.question_latency_ms ?? row.latency_ms,
    lexical_concept_recall: row.lexical_concept_recall,
    concept_groups_matched: row.concept_groups_matched, concept_groups_total: row.concept_groups_total,
  }));
  runSummaries.push({
    file, run_label: file.includes('medium') ? 'Targeted medium-effort probe' : file.includes('smoke') ? 'Live phase-gate smoke check' : !rows.length && questions.length ? 'Refined uncertainty Q&A' : file.includes('refined') ? 'Refined sampling' : file.includes('adaptive') ? 'First adaptive iteration' : path.basename(file, '-results.json'),
    results_sha256: digest(bytes), model: data.model, tested_at: data.tested_at,
    bank: data.bank, bank_version: data.bank.includes('-v2') ? 'Revised anchors v2' : 'Original v1',
    bank_sha256: data.bank_sha256, frame_pack_sha256: data.frame_pack_sha256,
    samples: data.samples, window_seconds: data.window_seconds,
    total: rows.length, correct, ui_correct: rows.filter(row => row.ui_match).length,
    wrong: rows.filter(row => row.result === 'wrong').length,
    uncertain: rows.filter(row => row.result === 'uncertain').length,
    errors: rows.filter(row => row.result === 'error').length,
    full_expected_stage_count: bank.cases.filter(row => row.channel === 'stage').length,
    p50_latency_ms: quantile(latencies, 0.5), p95_latency_ms: quantile(latencies, 0.95),
    request_count: data.results.length, request_errors: data.results.filter(row => row.error).length,
    questions_answered: data.answered_questions ?? 0,
    question_p50_latency_ms: quantile(questions.map(row => row.latency_ms), 0.5),
    question_p95_latency_ms: quantile(questions.map(row => row.latency_ms), 0.95),
    lexical_concept_recall: data.lexical_concept_recall ?? null, questions, rows,
  });
}
const counts = {};
for (const [key, flag] of [['backend', '--backend-tests'], ['frontend', '--frontend-tests'], ['browser', '--browser-tests']]) {
  const value = option(flag);
  if (value) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) throw Error(`Invalid test count: ${flag}`);
    counts[key] = count;
  }
}
let uiReplay = null;
const replayFile = option('--ui-replay', 'qa/refined-ui-replay.json');
try {
  const bytes = await fs.readFile(resolve(replayFile));
  const data = JSON.parse(bytes);
  for (const replay of data.runs) {
    if (replay.model_requests !== 0 || replay.raw_observations_unchanged !== true) throw Error('UI replay must preserve raw observations without model calls');
    if (digest(await fs.readFile(resolve(replay.source_results))) !== replay.source_results_sha256) throw Error('UI replay source-results hash mismatch');
    if (digest(await fs.readFile(resolve(replay.source_frame_pack))) !== replay.frame_pack_sha256) throw Error('UI replay source-frame-pack hash mismatch');
    if (replay.cases.filter(row => row.replayed_ui_stage_id === row.expected_step_id).length !== replay.replayed_ui_matches) throw Error('UI replay match-count mismatch');
  }
  uiReplay = { file: replayFile, sha256: digest(bytes), ...data };
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let independentReview = null;
const reviewFile = option('--review');
if (reviewFile) {
  const bytes = await fs.readFile(resolve(reviewFile));
  independentReview = { file: reviewFile, sha256: digest(bytes), data: JSON.parse(bytes) };
}
const report = {
  prepared_at: new Date().toISOString(), scope: 'Process observation recognition update',
  baselines, runs: runSummaries, tests: counts, ui_replay: uiReplay, independent_review: independentReview,
  limits: [
    'Original v1 and revised-anchor v2 banks are scored separately; expected IDs and times are unchanged within each bank.',
    'Sampling, prompt, and evidence-validation changes are evaluated together; this comparison does not isolate a model improvement.',
    'Exact stage agreement is distinct from criterion completion, factual answer accuracy, and clinical validity.',
    'Displayed descriptions and phase evidence are actual model outputs. This report builder validates bank hashes, case times, and expected IDs; it does not independently confirm every visual claim.',
    'A null phase is an explicit uncertainty response. Repeated or cropped movements may not uniquely identify the reference stage.',
    'Latency includes production processing and concurrent-request queueing; these are evaluation-run measurements, not isolated streaming latency.',
    'These finite single-run observations do not establish recognition of every future video or suitability for clinical decisions.',
  ],
};
const comparisonNote = run => {
  if (!run.total) return 'Question-only probe: stage recognition was not tested.';
  const previous = baselines.find(baseline => baseline.label === 'Previous Astra' && baseline.bank_version === run.bank_version);
  if (run.total !== previous.total) return 'Partial run; no full-bank comparison.';
  const delta = run.correct - previous.correct;
  return `${delta > 0 ? `${delta} more exact matches` : delta < 0 ? `${-delta} fewer exact matches` : 'Same exact-match count'} than previous Astra (${previous.correct}/${previous.total}) on this bank. Expected IDs and anchors are unchanged; sampling and prompt protocols differ.`;
};
const runCards = runSummaries.map(run => run.total ? `<article class="card"><div class="eyebrow">${esc(run.bank_version)} · ${esc(run.run_label)}</div><h2>${run.correct}<span> / ${run.total}</span></h2><p>Exact stage matches · ${esc(run.model)}</p><div class="bar"><i style="width:${run.correct / run.total * 100}%"></i></div><div class="metrics"><span><strong>${run.ui_correct}/${run.total}</strong>UI matches</span><span><strong>${run.uncertain}</strong>Uncertain</span><span><strong>${run.wrong}</strong>Wrong</span><span><strong>${run.errors}</strong>Errors</span></div><p>${esc(comparisonNote(run))}</p>${run.total !== run.full_expected_stage_count ? '<p class="warning">Partial run: all stage cases have not been evaluated.</p>' : ''}</article>` : `<article class="card"><div class="eyebrow">${esc(run.run_label)}</div><h2>${run.questions_answered}<span> answered</span></h2><p>${run.request_count} selected uncertainty-question requests · ${run.request_errors} errors</p><p>These selected questions were rechecked in this iteration. The complete 42-question set was not rerun.</p><p>Median ${seconds(run.question_p50_latency_ms)} · p95 ${seconds(run.question_p95_latency_ms)} · keyword proxy ${run.lexical_concept_recall == null ? '—' : `${(run.lexical_concept_recall * 100).toFixed(1)}%`}</p></article>`).join('');
const comparisonRows = [...baselines.map(run => `<tr><td>${esc(run.label)}</td><td>${esc(run.bank_version)}</td><td>${run.correct}/${run.total}</td><td>Historical run</td><td><a href="${rawLink(run.file)}">Raw results ↗</a></td></tr>`), ...runSummaries.map(run => `<tr><td>${esc(run.run_label)} · ${esc(run.model)}</td><td>${esc(run.bank_version)}</td><td><strong>${run.total ? `${run.correct}/${run.total}` : `${run.questions_answered} answers; no stage score`}</strong></td><td>${run.total ? `${seconds(run.p50_latency_ms)} median · ${seconds(run.p95_latency_ms)} p95` : 'Selected question probe'}</td><td><a href="${rawLink(run.file)}">Raw results ↗</a></td></tr>`)].join('');
const replayEvidence = uiReplay ? `<section class="panel"><div class="section-top"><h2>UI phase gate · separate replay validation</h2><a href="${rawLink(uiReplay.file)}">Replay artifact ↗</a></div><p>Recorded model outputs remain unchanged. The final UI gate was replayed against their verified source frames with <strong>zero new model requests</strong>. This checks whether supported model phases reach the UI; it does not increase the model’s recognition score.</p><div class="scroll"><table><thead><tr><th>Recorded run</th><th>Original live UI matches</th><th>Replayed UI matches</th></tr></thead><tbody>${uiReplay.runs.map(run => `<tr><td><a href="${rawLink(run.source_results)}">${esc(run.source_results)}</a></td><td>${run.recorded_ui_matches}/${run.cases.length}</td><td>${run.replayed_ui_matches}/${run.cases.length}</td></tr>`).join('')}</tbody></table></div><p class="muted">${esc(uiReplay.method)}</p><p class="muted">The targeted live smoke check is shown separately above. The complete model runs were captured before this UI-only correction.</p></section>` : '';
const reviewEvidence = independentReview ? `<section class="panel"><div class="section-top"><h2>Independent visual review</h2><a href="${rawLink(independentReview.file)}">Review artifact ↗</a></div><p>${esc(independentReview.data.scope ?? independentReview.data.review_scope ?? 'See the linked artifact for the exact reviewed cases, observations, and limitations.')}</p><p class="muted">This review is reported separately; it does not alter expected IDs or the recorded exact-stage scores.</p></section>` : '';
const questionEvidence = runSummaries.filter(run => run.questions.length).map(run => `<section class="panel"><div class="section-top"><h2>${esc(run.run_label)} · selected answers</h2><a href="${rawLink(run.file)}">Raw question results ↗</a></div><p class="muted">${run.questions_answered} answers from ${run.questions.length} selected requests. Keyword recall below is a lexical proxy; it does not establish semantic accuracy or safety. The prior complete 42-question evaluation remains in the <a href="model-comparison.html">previous report</a>.</p>${run.questions.map(row => `<details class="case"><summary><span>${esc(row.id)}</span><span class="stage">${row.error ? 'error' : `${seconds(row.latency_ms)}`}</span></summary><div class="case-body"><p><strong>Question:</strong> ${esc(row.question)}</p><p>${esc(row.answer ?? row.error)}</p><p class="muted">Lexical concepts: ${row.concept_groups_matched ?? '—'}/${row.concept_groups_total ?? '—'}</p></div></details>`).join('')}</section>`).join('');
const evidence = runSummaries.filter(run => run.total).map(run => `<section class="panel"><div class="section-top"><h2>${esc(run.bank_version)} · ${esc(run.run_label)}</h2><a href="${rawLink(run.file)}">Complete raw JSON ↗</a></div><p class="muted">Observed stage and UI stage are reported separately. Expand a case to inspect the model’s actual latest-view description and phase evidence.</p><div class="case-list">${run.rows.map(row => `<details class="case ${row.result}"><summary><span class="dot"></span><span>${esc(row.id)}</span><span class="badge">${esc(row.result)}</span><span class="stage">${esc(row.expected_step_id)} → ${esc(row.observed_step_id ?? 'uncertain')}</span></summary><div class="case-body"><p><strong>At ${row.timestamp_s.toFixed(2)}s</strong> · UI phase ${esc(row.ui_step_id ?? 'uncertain')} · ${seconds(row.guardian_latency_ms)}</p><p>${esc(row.summary || row.error)}</p>${row.phase_evidence ? `<p><strong>Phase evidence:</strong> ${esc(row.phase_evidence.evidence)}<br><span class="muted">Confidence ${esc(row.phase_evidence.confidence)} · frame indices ${esc(JSON.stringify(row.phase_evidence.frame_indices))} · claimed continuity ${esc(row.phase_evidence.continuity)}</span></p>` : ''}<p><strong>Guidance:</strong> ${esc(row.guidance)}</p><p class="muted">Actual frame times: ${esc(row.frame_times_s.map(time => time.toFixed(3)).join(', '))}</p></div></details>`).join('')}</div><details class="provenance"><summary>Bank and input provenance</summary><p>Bank: <a href="${rawLink(run.bank)}">${esc(run.bank)}</a><br>Bank SHA256: <code>${esc(run.bank_sha256)}</code><br>Frame pack SHA256: <code>${esc(run.frame_pack_sha256 ?? 'server-sampled input')}</code><br>Results SHA256: <code>${esc(run.results_sha256)}</code><br>Budget: ${run.samples} images / ${run.window_seconds}s trailing window<br>Tested: ${esc(run.tested_at)}</p></details></section>`).join('');
const tests = Object.keys(counts).length ? `<section class="panel"><h2>Software verification</h2><p>${Object.entries(counts).map(([key, count]) => `<strong>${count}</strong> ${key === 'browser' ? 'additional browser cases' : `${esc(key)} suite tests`}`).join(' · ')} passed.</p><p class="muted">Passing software tests verify defined behavior; they do not establish that every model prediction is correct.</p></section>` : '';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recognition update · Process Guide</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;background:#080e19;color:#e8f0fb}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 8% 0%,#13344688,transparent 48%),radial-gradient(ellipse at 95% 15%,#25234b66,transparent 45%),#080e19}main{max-width:1240px;margin:auto;padding:40px 28px 64px}a{color:#80e6da;text-underline-offset:4px;display:inline-flex;align-items:center;min-height:44px;min-width:44px}a:focus-visible,summary:focus-visible{outline:3px solid #a1edcc;outline-offset:4px;border-radius:6px}nav{display:flex;gap:20px;flex-wrap:wrap;font-size:14px}header{padding:48px 0 28px}.eyebrow{color:#7cd7cb;text-transform:uppercase;font-size:12px;letter-spacing:.12em;font-weight:700}h1{font-size:clamp(32px,5vw,54px);letter-spacing:-.05em;line-height:1.05;margin:14px 0}h2{letter-spacing:-.025em}p{line-height:1.65;max-width:960px}.muted{color:#a4b3c7}.intro{font-size:17px;color:#becbdb}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px;margin-bottom:24px}.card,.panel{border:1px solid #26384b;background:#101b2be0;border-radius:20px;padding:26px}.card h2{font-size:58px;line-height:1;margin:20px 0 12px}.card h2 span{font-size:25px;color:#7f93ac}.card>p{font-size:14px;color:#a9bbd2}.bar{height:7px;border-radius:99px;background:#263849;overflow:hidden;margin:22px 0}.bar i{height:100%;display:block;background:linear-gradient(90deg,#37bea9,#a1edcc);border-radius:99px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;font-size:11px;color:#9baec3}.metrics strong{display:block;font-size:20px;color:#e8f0fb;margin-bottom:4px}.panel{margin:22px 0}.panel>h2{margin-top:0;font-size:23px}.scroll{overflow:auto}table{border-collapse:collapse;min-width:710px;width:100%;font-size:14px;text-align:left}th{color:#8aa1ba;font-size:12px;font-weight:600}th,td{padding:16px 13px;border-bottom:1px solid #28384b}.section-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.section-top h2{font-size:22px;margin:0}.section-top a{font-size:13px}.case-list{margin-top:22px}.case{border:1px solid #2b3c50;border-radius:12px;margin:10px 0;overflow:hidden}.case summary{display:flex;align-items:center;gap:12px;cursor:pointer;min-height:56px;padding:14px;font-size:13px;list-style:none}.case summary:hover{background:#1b293a}.case summary>span{overflow-wrap:anywhere}.dot{width:7px;height:7px;border-radius:50%;background:#6fd2ad;flex-shrink:0}.uncertain .dot{background:#e3bb70}.wrong .dot,.error .dot{background:#ef8c91}.badge{text-transform:uppercase;letter-spacing:.05em;font-size:10px;color:#a8bed4}.stage{margin-left:auto;white-space:nowrap;color:#c8daeb}.case-body{padding:0 18px 14px;border-top:1px solid #2b3c50;font-size:14px}.case-body p{overflow-wrap:anywhere}.provenance{font-size:13px;margin-top:22px}.provenance summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#9ccecb}.provenance code{font-size:11px;overflow-wrap:anywhere;color:#9caec5}.warning{color:#e3bb70!important}ul{padding-left:22px;font-size:14px;color:#b2c1d3}li{line-height:1.7;margin:9px 0}footer{color:#7890a9;font-size:12px;padding:12px 0}@media(max-width:600px){main{padding:24px 14px 40px}header{padding:34px 4px 18px}.card,.panel{padding:20px;border-radius:16px}.case summary{flex-wrap:wrap;gap:9px;font-size:12px}.case summary>span:nth-child(2){flex:1 1 180px;min-width:0}.stage{margin-left:16px}.case-body{padding:0 13px 10px}.cards{grid-template-columns:1fr}}
</style></head><body><main><nav><a href="../../../../">Open app ↗</a><a href="../index.html">Videos & instructions</a><a href="model-comparison.html">Previous model comparison</a></nav><header><div class="eyebrow">Process Guide · evaluated recognition</div><h1>Clear evidence.<br>Measured progress.</h1><p class="intro">The latest recognition changes are tested against preserved stage questions and expected answers. Correct matches, uncertainty, wrong stages, and errors are shown separately.</p></header><div class="cards">${runCards}</div><section class="panel"><h2>Compare within each question bank</h2><p class="muted">The original bank preserves every original anchor. The v2 bank contains the earlier revised anchors and remains a separate diagnostic set. Different banks cannot be combined into one accuracy claim.</p><div class="scroll"><table><thead><tr><th>Run</th><th>Question bank</th><th>Exact matches</th><th>Latency</th><th>Evidence</th></tr></thead><tbody>${comparisonRows}</tbody></table></div><p class="muted">Latency includes production processing and concurrent-request queueing. Frame selection and prompt changes are evaluated together.</p></section>${replayEvidence}${evidence}${questionEvidence}${reviewEvidence}${tests}<section class="panel"><h2>What these results establish</h2><ul>${report.limits.map(limit => `<li>${esc(limit)}</li>`).join('')}</ul><p><a href="recognition-update.json">Download the comparison data ↗</a></p></section><footer>Prepared ${esc(report.prepared_at)} · Source-grounded educational process observation</footer></main></body></html>`;
await fs.writeFile(path.join(root, 'qa/recognition-update.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(root, 'qa/recognition-update.html'), html);
console.log(JSON.stringify({ report: 'qa/recognition-update.html', runs: runSummaries.map(({ file, correct, total, wrong, uncertain, errors }) => ({ file, correct, total, wrong, uncertain, errors })) }));
