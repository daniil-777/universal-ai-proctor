import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sampleWindowFramesFast} from '../../backend/dist/pipeline/frames.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const bankFile='qa/recognition-question-bank-v2.json';
const bankBytes=await fs.readFile(path.join(root,bankFile));
const bank=JSON.parse(bankBytes);
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const destination=path.join(root,'qa/model-frame-packs');
await fs.mkdir(destination,{recursive:true});
const rows=[];
for(const c of bank.cases){
 const sample=manifest.scenarios.find(s=>s.id===c.scenario_id);
 if(!sample)throw Error('Unknown scenario '+c.scenario_id);
 const times=[];
 const frames=await sampleWindowFramesFast(path.join(root,sample.video),Math.max(0,c.timestamp_s-8),c.timestamp_s,9,{compress:false,recentMotion:true,onSampleTimes:t=>times.push(...t)});
 if(!frames.length||times.length!==frames.length)throw Error('Missing frames/timestamps '+c.id);
 const files=[];
 for(const [i,bytes]of frames.entries()){
  const file='qa/model-frame-packs/'+c.id+'-'+i+'.jpg';
  await fs.writeFile(path.join(root,file),bytes);
  files.push({file,sha256:hash(bytes),timestamp_s:times[i]});
 }
 rows.push({id:c.id,scenario_id:c.scenario_id,current_s:c.timestamp_s,source_sha256:sample.sha256,frames:files});
 console.log(JSON.stringify({case_id:c.id,frames:frames.length,times}));
}
await fs.writeFile(path.join(root,'qa/frozen-frame-pack.json'),JSON.stringify({version:1,bank:bankFile,bank_sha256:hash(bankBytes),samples:9,window_seconds:8,latest_motion_seconds:.8,description:'Identical source-grounded JPEG images and displayed timestamps for every model. No future frames. Full-resolution input; production decoding remains identical across models.',cases:rows},null,2));
