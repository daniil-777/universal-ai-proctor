import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const base=process.env.GUIDANCE_API_BASE||'http://127.0.0.1:8101';
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const args=process.argv.slice(2);
const option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const prefix=option('--output-prefix','live-recognition');
if(!/^[a-z0-9-]+$/.test(prefix))throw Error('Invalid output prefix');
const samples=Number(option('--samples','3')),windowSeconds=Number(option('--window','1'));
const guardianOnly=args.includes('--guardian-only');
const questionsOnly=args.includes('--questions-only');
if(guardianOnly&&questionsOnly)throw Error('Choose Guardian-only or questions-only');
const provider=option('--provider','openai'), model=option('--model','gpt-4o');
const reasoningEffort=option('--reasoning','low');
if(!['low','medium','high'].includes(reasoningEffort))throw new Error('Unsupported reasoning effort');
const framePackFile=option('--frame-pack','');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const framePackBytes=framePackFile?await fs.readFile(path.join(root,framePackFile)):null;
const framePack=framePackBytes?JSON.parse(framePackBytes):null;
const only=option('--only','');
const bankFile=option('--bank','qa/recognition-question-bank.json');
const bankBytes=await fs.readFile(path.join(root,bankFile));
const bank=JSON.parse(bankBytes);
const provenance={model,provider,reasoning_effort:reasoningEffort,mock:false,bank_sha256:digest(bankBytes),frame_pack_sha256:framePackBytes?digest(framePackBytes):null};
if(framePack&&framePack.bank_sha256!==provenance.bank_sha256)throw Error('Frozen frames belong to another question bank');
const cases=bank.cases;
if(!Array.isArray(cases)||cases.length<42)throw Error('All32stagecases and10uncertaintyquestions required');
const results=process.argv.includes('--resume')?JSON.parse(await fs.readFile(path.join(root,'qa/'+prefix+'-progress.json'),'utf8')).results:[];
let saving=Promise.resolve();
async function saveProgress(){
 saving=saving.then(async()=>{const target=path.join(root,'qa/'+prefix+'-progress.json'),temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify({...provenance,results},null,2));await fs.rename(temporary,target);});
 await saving;
}
async function api(session,route,body,method='POST'){
 const r=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),'x-guidance-session':session},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(55000)});
 const data=await r.json();if(!r.ok)throw Error(r.status+': '+data.error);return data;
}
const health=await (await fetch(base+'/api/health')).json();
if(health.mock||!health.providers[provider])throw Error('Configured live provider required: '+provider);
const contains=(answer,terms)=>terms.some(term=>answer.toLowerCase().includes(String(term).toLowerCase()));
await Promise.all(manifest.scenarios.map(async sample=>{
 const session=crypto.randomUUID(); await api(session,'/api/source',{source_id:session,kind:'video',name:sample.name});
 const loaded=await api(session,'/api/video/load-sample',{id:sample.id,source_id:session});
 if(loaded.workflow.steps.length!==sample.guidance_steps)throw Error('Missing loaded stages for '+sample.id);
 const selected=cases.filter(c=>c.scenario_id===sample.id&&!results.some(r=>r.id===c.id)&&(!guardianOnly||c.channel==='stage')&&(!only||only.split(',').some(term=>c.id.includes(term))));
 console.log(JSON.stringify({scenario:sample.id,loaded_steps:loaded.workflow.steps.length,cases:selected.length}));
 let revision=loaded.revision;
 for(const c of selected){
  const started=Date.now();
  const body={provider,model_id:model,reasoning_effort:reasoningEffort,source_id:session,revision,current_s:c.timestamp_s,n_samples:samples,window_s:windowSeconds,processing:'sampling',compress:false,vision_detail:'high'};
  const row={id:c.id,scenario_id:sample.id,channel:c.channel,expected_step_id:c.expected_step_id,timestamp_s:c.timestamp_s,question:c.question,reference_answer:c.reference_answer,expected_concepts:c.expected_concepts,prohibited_claims:c.prohibited_claims,loaded_steps:loaded.workflow.steps.length};
  try{
   if(framePack){
    const packed=framePack.cases.find(p=>p.id===c.id);
    if(!packed||packed.current_s!==c.timestamp_s)throw Error('Missing/mismatched frozen case '+c.id);
    body.frames_b64=[];body.frame_times_s=[];row.frame_sha256s=[];
    for(const frame of packed.frames){const bytes=await fs.readFile(path.join(root,frame.file));const actual=digest(bytes);if(actual!==frame.sha256)throw Error('Frame hash mismatch');body.frames_b64.push(bytes.toString('base64'));body.frame_times_s.push(frame.timestamp_s);row.frame_sha256s.push(actual);}
   }
   if(c.channel==='stage'&&!questionsOnly){
    const guardianStart=Date.now();const g=await api(session,'/api/guidance/analyze',body);row.guardian_latency_ms=Date.now()-guardianStart;revision=g.revision;body.revision=revision;
    row.guardian={observation:g.observation,current_stage_id:g.current_stage_id,used_frames:g.used_frames,frame_times_s:g.frame_times_s,ms:g.ms,image_quality:g.image_quality,criteria:g.workflow.steps.map(s=>({id:s.id,complete:s.complete,progress:s.progress,criteria:s.criteria}))};
    row.raw_stage_match=g.observation.current_step_id===c.expected_step_id;
    row.ui_stage_match=g.current_stage_id===c.expected_step_id;
   }
   if(!guardianOnly){
   const questionStart=Date.now();const a=await api(session,'/api/llm/ask',{...body,question:c.question,voice:false});row.question_latency_ms=Date.now()-questionStart;
   row.answer=a.answer;row.used_frames=a.used_frames;
   const groups=c.expected_concepts||[];
   row.concept_groups_matched=groups.filter(group=>contains(a.answer,Array.isArray(group)?group:[group])).length;
   row.concept_groups_total=groups.length;
   row.lexical_concept_recall=groups.length?row.concept_groups_matched/groups.length:null;
   }
   row.latency_ms=Date.now()-started;
  }catch(e){row.error=e.message;row.latency_ms=Date.now()-started;}
  results.push(row);
  await saveProgress();
  console.log(JSON.stringify({id:row.id,stage_match:row.raw_stage_match,concept_recall:row.lexical_concept_recall,error:row.error,ms:row.latency_ms}));
 }
 await api(session,'/api/video',undefined,'DELETE');
}));
const stage=results.filter(r=>r.channel==='stage'), answered=results.filter(r=>r.answer);
const report={tested_at:new Date().toISOString(),...provenance,bank:bankFile,samples:framePack?.samples??samples,window_seconds:framePack?.window_seconds??windowSeconds,guardian_only:guardianOnly,protocol:framePack?'Chronological cases in all five real videos. Every model receives the exact same SHA256-verified frozen JPEGs and displayed timestamps through the production API, same guides and system prompt; selected reasoning effort recorded in metadata where supported. No expected answers/IDs passed to the model. Independent visual review is distinct from strict stage ID and lexical concept recall. Single observations do not establish sustained completion.':'Chronological anchors in all five real videos, actual frame budget/window recorded. Different banks or sampling protocols cannot be treated as isolated model improvements.',case_count:results.length,stage_case_count:stage.length,answered_questions:answered.length,errors:results.filter(r=>r.error).length,raw_stage_matches:stage.filter(r=>r.raw_stage_match).length,ui_stage_matches:stage.filter(r=>r.ui_stage_match).length,lexical_concept_recall:answered.length?answered.reduce((n,r)=>n+(r.lexical_concept_recall??0),0)/answered.length:null,results};
await fs.writeFile(path.join(root,'qa/'+prefix+'-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:undefined}));
