import test from 'node:test';
import assert from 'node:assert/strict';
import {compareRuns,percentile,renderComparison,summarizeRun} from './build-model-comparison.mjs';

const bank={cases:Array.from({length:42},(_,i)=>({id:`case-${i}`,scenario_id:'fixture-process',channel:i<32?'stage':'uncertainty',expected_step_id:i<32?`S${i+1}`:undefined,timestamp_s:i,question:'Visible phase?',reference_answer:'Review only visible evidence.'}))};
const run=(model='fixture-model')=>({model,provider:'fixture',mock:false,bank_sha256:'bank',frame_pack_sha256:'pack',results:bank.cases.map((c,i)=>({id:c.id,scenario_id:c.scenario_id,loaded_steps:32,answer:'Fixture answer',latency_ms:(i+1)*100,frame_sha256s:[`image-${i}`],...(c.channel==='stage'?{guardian:{observation:{current_step_id:c.expected_step_id,summary:'Fixture observation'},ms:(i+1)*50}}:{})}))});

test('preserves result provenance and exposes recorded run conditions without claiming controlled speed',()=>{
  const input={...run(),result_file:'actual-run.json',result_sha256:'exact-byte-hash',run_conditions:'Shared <4> inference slots'};
  const report=compareRuns([input],bank,'bank','pack');
  assert.equal(report.models[0].result_file,'actual-run.json');
  assert.equal(report.models[0].result_sha256,'exact-byte-hash');
  const html=renderComparison(report);
  assert.ok(html.includes('Shared &lt;4&gt; inference slots'));
  assert.ok(html.includes('controlled solo probes'));
});

test('keeps strict identity separate from independent visual correctness and Q&A errors',()=>{
  const input=run();
  input.results[0].visual_review={verdict:'wrong',flags:['unsupported movement'],notes:'ID matches but the visible claim does not.'};
  input.results[1].guardian.observation.current_step_id='S99';
  input.results[2].guardian.observation.current_step_id=null;
  delete input.results[3].guardian;input.results[3].error='Guardian failed';
  input.results[4].error='Later Q&A failed';
  const result=summarizeRun(input,bank);
  assert.equal(result.loaded_stage_count,32);
  assert.deepEqual(result.strict_stage,{exact:29,wrong:1,uncertain:1,errors:1,pending:0,total:32});
  assert.equal(result.independent_visual.wrong,1);
  assert.equal(result.independent_visual.pending,31);
  assert.equal(result.request_errors,2);
  assert.equal(result.cases[4].stage_outcome,'exact');
});
test('missing observations and missing independent reviews remain pending',()=>{
  const input=run();input.results=input.results.slice(0,1);
  const result=summarizeRun(input,bank);
  assert.equal(result.strict_stage.exact,1);
  assert.equal(result.strict_stage.pending,31);
  assert.equal(result.strict_stage.uncertain,0);
  assert.equal(result.independent_visual.pending,32);
});
test('uses recorded nearest-rank latency percentiles without treating missing time as zero',()=>{
  assert.equal(percentile([100,200,300,400],.5),200);
  assert.equal(percentile([100,200,300,400],.95),400);
  assert.equal(percentile([], .95),null);
  assert.equal(percentile([NaN,-1,100],.5),100);
});
test('requires the same frozen bank and actual submitted images across models',()=>{
  const runs=[run('A'),run('B'),run('C')];
  assert.equal(compareRuns(runs,bank,'bank','pack').input_verification.submitted_image_hashes_match,true);
  const bad=structuredClone(runs);bad[1].frame_pack_sha256='different';
  assert.throws(()=>compareRuns(bad,bank,'bank','pack'),/mismatch/);
  const changed=structuredClone(runs);changed[1].results[0].frame_sha256s=['other-image'];
  assert.throws(()=>compareRuns(changed,bank,'bank','pack'),/image hashes differ/);
  const missing=structuredClone(runs);delete missing[1].results[0].frame_sha256s;
  assert.equal(compareRuns(missing,bank,'bank','pack').input_verification.submitted_image_hashes_match,false);
});
test('escapes model responses and rejects duplicate IDs without inventing a winner',()=>{
  const input=run('<script>alert(1)</script>');input.results[0].answer='<img src=x onerror=alert(1)>';
  const report=compareRuns([input],bank,'bank','pack');
  const html=renderComparison(report);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('fewer than three model runs'));
  input.results.push(input.results[0]);
  assert.throws(()=>summarizeRun(input,bank),/Duplicate case/);
});
test('validates Guardian-only submitted images against the frozen manifest without requiring unrun Q&A',()=>{
  const runs=[run('A'),run('B'),run('C')];
  for(const r of runs){r.results=r.results.slice(0,32);for(const row of r.results)delete row.answer;}
  const pack={bank_sha256:'bank',cases:bank.cases.map((c,i)=>({id:c.id,frames:[{sha256:`image-${i}`}]}))};
  const report=compareRuns(runs,bank,'bank','pack',[],pack);
  assert.equal(report.input_verification.submitted_image_hashes_match,true);
  assert.equal(report.input_verification.images_checked_against_frozen_manifest,true);
  assert.equal(report.input_verification.submitted_cases_checked,32);
  assert.equal(report.input_verification.not_submitted_cases,10);
  assert.equal(report.models[0].qa_status,'not_run');
  pack.cases[0].frames[0].sha256='changed';
  assert.throws(()=>compareRuns(runs,bank,'bank','pack',[],pack),/do not match frozen/);
});
test('keeps request latency, server compute time and later question latency distinct',()=>{
  const input=run();
  input.results[0].guardian_latency_ms=500;
  input.results[0].question_latency_ms=800;
  const result=summarizeRun(input,bank);
  assert.equal(result.cases[0].guardian_latency_ms,500);
  assert.equal(result.cases[0].guardian_compute_latency_ms,50);
  assert.equal(result.cases[0].question_latency_ms,800);
  assert.equal(result.cases[0].total_case_latency_ms,1300);
});
