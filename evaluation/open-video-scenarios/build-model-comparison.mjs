import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const percentile=(values,p)=>{
  const sorted=values.filter(v=>Number.isFinite(v)&&v>=0).sort((a,b)=>a-b);
  return sorted.length?sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]:null;
};
const visualVerdicts=new Set(['correct','wrong','uncertain']);
export function summarizeRun(run,bank,reviews=[]){
  const ids=new Set(bank.cases.map(c=>c.id));
  const rows=new Map();
  for(const row of run.results??[]){
    if(!ids.has(row.id))throw Error(`Unknown case ${row.id} in ${run.model}`);
    if(rows.has(row.id))throw Error(`Duplicate case ${row.id} in ${run.model}`);
    rows.set(row.id,row);
  }
  const cases=bank.cases.map(reference=>{
    const row=rows.get(reference.id);
    const returned=row?.guardian?.observation?.current_step_id??null;
    const hasObservation=!!row?.guardian?.observation;
    const stageOutcome=reference.channel!=='stage'?'not_applicable':!hasObservation?(row?.error?'error':'pending'):returned===reference.expected_step_id?'exact':returned===null||returned===''?'uncertain':'wrong';
    const review=reviews.find(r=>r.model===run.model&&(!r.provider||r.provider===run.provider)&&r.case_id===reference.id)||row?.visual_review;
    if(review&&!visualVerdicts.has(review.verdict))throw Error(`Invalid visual review verdict for ${run.model}/${reference.id}`);
    const guardianMs=Number.isFinite(row?.guardian_latency_ms)?row.guardian_latency_ms:Number.isFinite(row?.guardian?.ms)?row.guardian.ms:null;
    const questionMs=Number.isFinite(row?.question_latency_ms)?row.question_latency_ms:null;
    return{...reference,result_received:!!row,returned_step_id:returned,stage_outcome:stageOutcome,visual_review:review?{verdict:review.verdict,flags:Array.isArray(review.flags)?review.flags:[],notes:review.notes||'',reviewer:review.reviewer||null}:{verdict:'pending',flags:[],notes:'Independent visual review has not been supplied.'},answer:row?.answer??null,guardian_summary:row?.guardian?.observation?.summary??null,error:row?.error??null,guardian_latency_ms:guardianMs,guardian_compute_latency_ms:Number.isFinite(row?.guardian?.ms)?row.guardian.ms:null,question_latency_ms:questionMs,total_case_latency_ms:guardianMs!==null&&questionMs!==null?guardianMs+questionMs:Number.isFinite(row?.latency_ms)?row.latency_ms:null,frame_sha256s:row?.frame_sha256s??null,frame_times_s:row?.guardian?.frame_times_s??row?.frame_times_s??null};
  });
  const stages=cases.filter(c=>c.channel==='stage');
  const count=(field,value)=>stages.filter(c=>c[field]===value).length;
  const visual=value=>stages.filter(c=>c.visual_review.verdict===value).length;
  const scenarioIds=[...new Set(bank.cases.map(c=>c.scenario_id))];
  const loaded=scenarioIds.map(id=>{
    const expected=bank.cases.filter(c=>c.scenario_id===id&&c.channel==='stage').length;
    const supplied=[...rows.values()].filter(r=>r.scenario_id===id&&Number.isFinite(r.loaded_steps)).map(r=>r.loaded_steps);
    return{id,expected,loaded:supplied.length&&supplied.every(n=>n===expected)?expected:null};
  });
  const guardianLatencies=cases.map(c=>c.guardian_latency_ms).filter(v=>v!==null);
  const caseLatencies=cases.map(c=>c.total_case_latency_ms).filter(v=>v!==null);
  const questionLatencies=cases.map(c=>c.question_latency_ms).filter(v=>v!==null);
  return{result_file:run.result_file||null,result_sha256:run.result_sha256||null,run_conditions:typeof run.run_conditions==='string'?run.run_conditions:null,model:run.model,provider:run.provider||'unspecified',tested_at:run.tested_at||null,bank_sha256:run.bank_sha256,frame_pack_sha256:run.frame_pack_sha256,loaded_stage_count:loaded.every(s=>s.loaded!==null)?loaded.reduce((n,s)=>n+s.loaded,0):null,reference_stage_count:stages.length,case_count:cases.length,received_cases:rows.size,answers:cases.filter(c=>c.answer).length,qa_status:cases.filter(c=>c.answer).length===42?'complete':cases.some(c=>c.answer)?'partial':'not_run',request_errors:cases.filter(c=>c.error).length,strict_stage:{exact:count('stage_outcome','exact'),wrong:count('stage_outcome','wrong'),uncertain:count('stage_outcome','uncertain'),errors:count('stage_outcome','error'),pending:count('stage_outcome','pending'),total:stages.length},independent_visual:{correct:visual('correct'),wrong:visual('wrong'),uncertain:visual('uncertain'),pending:visual('pending'),flagged_cases:stages.filter(c=>c.visual_review.flags.length).length},guardian_latency_ms:{samples:guardianLatencies.length,p50:percentile(guardianLatencies,.5),p95:percentile(guardianLatencies,.95)},question_latency_ms:{samples:questionLatencies.length,p50:percentile(questionLatencies,.5),p95:percentile(questionLatencies,.95)},total_case_latency_ms:{samples:caseLatencies.length,p50:percentile(caseLatencies,.5),p95:percentile(caseLatencies,.95)},scenarios:loaded.map(s=>({...s,strict_stage:{exact:stages.filter(c=>c.scenario_id===s.id&&c.stage_outcome==='exact').length,wrong:stages.filter(c=>c.scenario_id===s.id&&c.stage_outcome==='wrong').length,uncertain:stages.filter(c=>c.scenario_id===s.id&&c.stage_outcome==='uncertain').length}})),cases};
}

export function compareRuns(runs,bank,bankSha,packSha,reviews=[],framePack){
  if(bank.cases?.length!==42||bank.cases.filter(c=>c.channel==='stage').length!==32)throw Error('Comparison requires the same42-case bank with32stage cases.');
  if(new Set(bank.cases.map(c=>c.id)).size!==42)throw Error('Duplicate question-bank IDs');
  const modelKeys=new Set();
  for(const run of runs){
    if(run.mock!==false)throw Error(`Live mock:false result required for ${run.model}`);
    if(run.bank_sha256!==bankSha||run.frame_pack_sha256!==packSha)throw Error(`Frozen bank/frame-pack mismatch for ${run.model}; do not compare differing inputs.`);
    const key=`${run.provider||'unspecified'}:${run.model}`;
    if(modelKeys.has(key))throw Error(`Duplicate model run ${key}`);
    modelKeys.add(key);
  }
  const models=runs.map(r=>summarizeRun(r,bank,reviews));
  let frameHashesVerified=true;
  let checkedCases=0,notSubmittedCases=0;
  if(framePack&&framePack.bank_sha256!==bankSha)throw Error('Frozen frame pack belongs to a different question bank.');
  for(const reference of bank.cases){
    const submitted=models.map(m=>m.cases.find(c=>c.id===reference.id)).filter(c=>c.result_received);
    if(!submitted.length){notSubmittedCases++;continue;}
    const lists=submitted.map(c=>c.frame_sha256s);
    if(lists.some(v=>!Array.isArray(v)||!v.length)){frameHashesVerified=false;continue;}
    if(lists.some(v=>JSON.stringify(v)!==JSON.stringify(lists[0])))throw Error(`Actual submitted image hashes differ for ${reference.id}`);
    const expected=framePack?.cases?.find(c=>c.id===reference.id)?.frames?.map(f=>f.sha256);
    if(framePack&&(!expected?.length||JSON.stringify(expected)!==JSON.stringify(lists[0])))throw Error(`Submitted images do not match frozen case ${reference.id}`);
    checkedCases++;
  }
  return{schema_version:1,prepared_at:new Date().toISOString(),bank_sha256:bankSha,frame_pack_sha256:packSha,input_verification:{manifest_hashes_match:true,submitted_image_hashes_match:frameHashesVerified,submitted_cases_checked:checkedCases,not_submitted_cases:notSubmittedCases,images_checked_against_frozen_manifest:!!framePack&&frameHashesVerified,model_count:models.length,three_model_target_met:models.length>=3},reference_stages:32,prepared_questions:42,models,notes:['Stages loaded measures successful reference parsing, not visual recognition or completion.','Strict recognition uses the exact raw Guardian current_step_id. A null ID is uncertain; a different ID is wrong; request failures and missing observations are separate.','Independent visual correctness is a separate reviewed judgment. Exact stage agreement alone does not verify the explanation or any claimed movement. Missing reviews remain pending.','Guardian latency uses the recorded request duration, with server analyze time as a fallback. Q&A latency is separate. Combined case duration sums recorded Guardian and question durations when both exist; otherwise recorded case time is used. Percentiles use the nearest-rank method over recorded observations, not missing values.','End-to-end latency also depends on concurrent requests, queues and shared inference slots. Compare controlled solo probes for model speed; these run percentiles alone do not establish which model is inherently fastest.','Identical frozen manifest hashes are required. Submitted image hashes are checked against the frozen manifest and across models when supplied. Cases not yet submitted are counted separately.','Guardian-only runs intentionally leave Q&A not run. Later Q&A may be added to the same unique case rows without changing frozen inputs.','Prepared anchors do not assess every moment, sustained completion, clinical validity or all future footage. No automatic model selection is made.']};
}

const ms=value=>value===null?'—':`${(value/1000).toFixed(2)}s`;
const badge=(state,label=state)=>`<span class="badge ${escape(state)}">${escape(label)}</span>`;
export function renderComparison(report){
  const models=report.models;
  const cards=models.map(m=>`<article class="model"><p class="eyebrow">${escape(m.provider)}</p><h2>${escape(m.model)}</h2><div class="score"><strong>${m.strict_stage.exact}<small> / 32</small></strong><span>Exact stage IDs</span></div><div class="outcomes">${badge('wrong',`${m.strict_stage.wrong} wrong`)} ${badge('uncertain',`${m.strict_stage.uncertain} uncertain`)} ${badge('error',`${m.request_errors} request errors`)}</div><dl><div><dt>Reference stages loaded</dt><dd>${m.loaded_stage_count===null?'Not verified':`${m.loaded_stage_count} / 32`}</dd></div><div><dt>Guardian latency p50 / p95</dt><dd>${ms(m.guardian_latency_ms.p50)} / ${ms(m.guardian_latency_ms.p95)}</dd></div><div><dt>Run conditions</dt><dd>${escape(m.run_conditions||'Not recorded; latency is not a controlled speed comparison.')}</dd></div><div><dt>Answers received</dt><dd>${m.qa_status==='not_run'?'Not run (Guardian-only)':`${m.answers} / 42 · ${m.qa_status}`}</dd></div><div><dt>Independent visual review</dt><dd>${m.independent_visual.correct} correct · ${m.independent_visual.wrong} wrong · ${m.independent_visual.uncertain} uncertain · ${m.independent_visual.pending} pending</dd></div></dl></article>`).join('');
  const strictRows=models.map(m=>`<tr><th scope="row">${escape(m.model)}</th><td>${m.loaded_stage_count??'—'}/32</td><td>${m.strict_stage.exact}/32</td><td>${m.strict_stage.wrong}</td><td>${m.strict_stage.uncertain}</td><td>${m.strict_stage.errors}</td><td>${m.strict_stage.pending}</td><td>${ms(m.guardian_latency_ms.p50)}</td><td>${ms(m.guardian_latency_ms.p95)}</td><td>${ms(m.total_case_latency_ms.p50)}</td><td>${ms(m.total_case_latency_ms.p95)}</td></tr>`).join('');
  const details=models[0]?.cases.map(reference=>`<details><summary><span>${escape(reference.id)} · ${reference.timestamp_s}s</span><small>${reference.channel==='stage'?`Expected ${escape(reference.expected_step_id)}`:'Uncertainty question'}</small></summary><p><b>Question:</b> ${escape(reference.question)}</p><p><b>Reference:</b> ${escape(reference.reference_answer)}</p><div class="case-models">${models.map(m=>{const c=m.cases.find(c=>c.id===reference.id);return`<section><h3>${escape(m.model)}</h3><div class="outcomes">${c.channel==='stage'?badge(c.stage_outcome,`${c.stage_outcome} ID · ${c.returned_step_id||'none'}`):''}${badge(c.visual_review.verdict,`Visual ${c.visual_review.verdict}`)}</div>${c.guardian_summary?`<p><b>Guardian:</b> ${escape(c.guardian_summary)}</p>`:''}<p><b>Answer:</b> ${escape(c.answer||c.error||'Not received')}</p><p><b>Review:</b> ${escape(c.visual_review.notes||'No notes supplied.')}</p>${c.visual_review.flags.length?`<p class="flags"><b>Flags:</b> ${c.visual_review.flags.map(escape).join(' · ')}</p>`:''}</section>`;}).join('')}</div></details>`).join('')||'';
  return`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Process Guide — Model recognition comparison</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6f7;color:#173340;font:15px/1.6 system-ui,sans-serif}header{background:#0b1f2d;color:#fff;padding:42px max(20px,calc((100vw - 1180px)/2))}header p{max-width:850px;color:#c7dbe2}h1{font-size:clamp(30px,5vw,48px);line-height:1.13;letter-spacing:-.03em;margin:14px 0}h2{font-size:21px;line-height:1.3;overflow-wrap:anywhere}h3{font-size:16px;overflow-wrap:anywhere}.eyebrow{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#11808d;font-weight:700}header .eyebrow{color:#91ddd7}main{max-width:1220px;margin:auto;padding:24px 20px 48px}a{display:inline-flex;align-items:center;min-height:44px;padding:8px 12px;margin:4px 4px 4px 0;color:#0b7181;border:1px solid #c8dce2;border-radius:8px;overflow-wrap:anywhere}header a{color:#c8f2ed;border-color:#486675}a:focus-visible,summary:focus-visible{outline:3px solid #d39022;outline-offset:3px}.intro{padding:20px;background:#e2eeee;border-left:4px solid #16838d;border-radius:0 10px 10px 0}.models{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px;margin:24px 0}.model{min-width:0;padding:22px;background:white;border:1px solid #d3e2e6;border-radius:16px}.model h2{margin:8px 0 18px}.score strong{font-size:40px;line-height:1;color:#087c89;display:block}.score small{font-size:20px;color:#6c8390;font-weight:500}.score span{font-size:12px;color:#58717c}.outcomes{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.badge{display:inline-block;padding:3px 9px;border-radius:6px;background:#edf2f3;color:#536b77;font-size:11px;font-weight:600}.exact,.correct{background:#dff2ec;color:#126a50}.wrong,.error{background:#fbe6e5;color:#9a3531}.uncertain{background:#fff0d7;color:#856018}dl{margin:18px 0 0}dl div{padding:9px 0;border-top:1px solid #e4ecef}dt{font-size:12px;color:#657c87}dd{margin:2px 0 0;font-size:13px;overflow-wrap:anywhere}.table-wrap{max-width:100%;overflow-x:auto;border:1px solid #d3e2e6;border-radius:12px;background:white}table{width:100%;min-width:880px;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e0e9ed;font-size:12px;vertical-align:top}thead{background:#e9f1f3}tbody th{overflow-wrap:anywhere;max-width:180px}.links{display:flex;flex-wrap:wrap;margin:20px 0}details{margin:12px 0;padding:16px;background:white;border:1px solid #d3e2e6;border-radius:12px;min-width:0}summary{min-height:44px;cursor:pointer;font-weight:650;overflow-wrap:anywhere}summary small{display:block;color:#687f89;font-weight:400}.case-models{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}.case-models section{min-width:0;border-top:1px solid #dfe9ec;padding-top:8px}p,.flags,code{overflow-wrap:anywhere}code{font-size:11px}footer{color:#657b87;font-size:12px;margin-top:28px}@media(max-width:480px){header{padding:30px 18px}main{padding:18px 16px 32px}.model{padding:18px}details{padding:14px}}@media print{details{break-inside:avoid}header{background:white;color:black}a{color:inherit}}</style><header><div class="eyebrow">PROCESS GUIDE · SAME FOOTAGE, DIFFERENT MODELS</div><h1>Recognition you can compare.</h1><p>${models.length} model runs · 32 prepared stage checks · 10 uncertainty questions. ${escape(report.prepared_at)}</p><a href="../index.html">Video library</a></header><main><div class="intro"><b>Loaded is not recognized.</b> All 32 reference stages are expected to load. Exact stage IDs, independently reviewed visual claims, uncertainty, errors and missing results are shown separately. Step completion is a different measure.<p><b>Input consistency:</b> frozen manifest hashes match. Submitted image hash check: ${report.input_verification.submitted_image_hashes_match?`passed for ${report.input_verification.submitted_cases_checked} submitted cases; ${report.input_verification.not_submitted_cases} not yet submitted`:'incomplete — one or more submitted runs omitted frame_sha256s'}.</p>${models.length<3?'<p><b>Comparison is provisional:</b> fewer than three model runs are available.</p>':''}</div><div class="models">${cards}</div><h2>Stage identity and response time</h2><p>Exact IDs use all 32 prepared stage checks as the denominator. Latencies use recorded samples; missing results are excluded. Guardian time and whole-case time are different measurements.</p><div class="table-wrap" role="region" aria-label="Model metrics; scroll horizontally on small screens" tabindex="0"><table><thead><tr><th>Model</th><th>Loaded</th><th>Exact ID</th><th>Wrong ID</th><th>Uncertain ID</th><th>Stage errors</th><th>Pending</th><th>Guardian p50</th><th>Guardian p95</th><th>Case p50</th><th>Case p95</th></tr></thead><tbody>${strictRows}</tbody></table></div><div class="links"><a href="model-comparison.json" download>Metrics and raw comparison</a><a href="model-comparison.txt" download>Plain text report</a></div><h2>Inspect the actual responses</h2><p>Expand a case to compare its reference, stage ID, answer and independent review across models.</p>${details}<footer>${report.notes.map(escape).map(n=>`<p>${n}</p>`).join('')}<p>Bank SHA-256: <code>${escape(report.bank_sha256)}</code><br>Frame-pack SHA-256: <code>${escape(report.frame_pack_sha256)}</code></p></footer></main></html>`;
}

async function main(){
  const args=process.argv.slice(2);
  const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const runsAt=args.indexOf('--runs');
  if(runsAt<0)throw Error('Usage: node build-model-comparison.mjs --bank FILE --frame-pack FILE [--reviews FILE] --runs RUN1.json RUN2.json RUN3.json');
  const tail=args.slice(runsAt+1);
  const nextOption=tail.findIndex(x=>x.startsWith('--'));
  const runFiles=tail.slice(0,nextOption<0?tail.length:nextOption);
  if(!runFiles.length)throw Error('No saved model runs supplied');
  const resolve=file=>path.resolve(root,file);
  const bankBytes=await fs.readFile(resolve(option('--bank','qa/recognition-question-bank-v2.json')));
  const packBytes=await fs.readFile(resolve(option('--frame-pack','qa/frozen-frame-pack.json')));
  const bank=JSON.parse(bankBytes),pack=JSON.parse(packBytes);
  if(!pack||typeof pack!=='object')throw Error('Invalid frozen frame-pack manifest');
  const reviewsFile=option('--reviews',null);
  const reviews=reviewsFile?JSON.parse(await fs.readFile(resolve(reviewsFile),'utf8')).reviews||[]:[];
  const runs=await Promise.all(runFiles.map(async file=>{const bytes=await fs.readFile(resolve(file));return{...JSON.parse(bytes),result_file:file,result_sha256:hash(bytes)};}));
  const report=compareRuns(runs,bank,hash(bankBytes),hash(packBytes),reviews,pack);
  const latencyNote=option('--latency-note',null);
  if(latencyNote)report.notes.push(latencyNote);
  report.result_file_hashes=runs.map(run=>({file:run.result_file,sha256:run.result_sha256}));
  report.source_files={runs:runFiles,bank:option('--bank','qa/recognition-question-bank-v2.json'),frame_pack:option('--frame-pack','qa/frozen-frame-pack.json'),reviews:reviewsFile};
  await fs.mkdir(path.join(root,'qa'),{recursive:true});
  await fs.writeFile(path.join(root,'qa/model-comparison.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(root,'qa/model-comparison.html'),renderComparison(report));
  const text=['PROCESS GUIDE — MODEL RECOGNITION COMPARISON',...report.notes,'',...report.models.map(m=>`${m.provider}/${m.model}: loaded ${m.loaded_stage_count??'unverified'}/32; strict IDs ${m.strict_stage.exact} exact, ${m.strict_stage.wrong} wrong, ${m.strict_stage.uncertain} uncertain, ${m.strict_stage.errors} errors, ${m.strict_stage.pending} pending. Visual reviews ${m.independent_visual.correct} correct, ${m.independent_visual.wrong} wrong, ${m.independent_visual.uncertain} uncertain, ${m.independent_visual.pending} pending. Run conditions: ${m.run_conditions||'not recorded'}. Guardian p50/p95 ${ms(m.guardian_latency_ms.p50)}/${ms(m.guardian_latency_ms.p95)}; whole-case p50/p95 ${ms(m.total_case_latency_ms.p50)}/${ms(m.total_case_latency_ms.p95)}.`),'',`Bank SHA256: ${report.bank_sha256}`,`Frame-pack SHA256: ${report.frame_pack_sha256}`].join('\n');
  await fs.writeFile(path.join(root,'qa/model-comparison.txt'),text+'\n');
  console.log(JSON.stringify({output:'qa/model-comparison.html',models:report.models.length,input_verification:report.input_verification,metrics:report.models.map(({cases,...m})=>m)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
