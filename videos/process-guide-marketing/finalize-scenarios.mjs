import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const project=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(project,'scenarios');
const appRoot=path.resolve(project,'../..');
const plan=JSON.parse(await fs.readFile(path.join(root,'scenario-plan.json'),'utf8'));
const completed=JSON.parse(await fs.readFile(path.join(root,'generation-results.json'),'utf8'));
const jobs=completed.jobs??completed.structuredContent?.jobs;
if(!Array.isArray(jobs)||jobs.length!==5||jobs.some(j=>j.status!=='completed'||!j.result_url))throw Error('All five completed job URLs are required. No unknown job is resubmitted.');

const checks=[];
for(const s of plan.scenarios){
 const job=jobs.find(j=>j.index===Number(s.id)-1);
 if(!job)throw Error('Missing result for '+s.id);
 const target=path.join(root,s.video);
 let mediaPath=target;
 try{await fs.access(target);}catch{
  mediaPath=target+'.partial';
  const response=await fetch(job.result_url);
  if(!response.ok)throw Error(`Video download ${s.id}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<1000)throw Error('Video unexpectedly empty: '+s.id);
  await fs.writeFile(mediaPath,bytes);
 }
 let probe;
 try{
 probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',mediaPath],{encoding:'utf8'}));
 const stream=probe.streams.find(x=>x.codec_type==='video');
 const duration=Number(probe.format.duration);
 if(stream?.width!==1920||stream?.height!==1080||!Number.isFinite(duration)||duration<3.8||duration>4.3)throw Error(`Unexpected generated format for ${s.id}: ${stream?.width}x${stream?.height}, ${duration}s`);
 execFileSync('ffmpeg',['-v','error','-xerror','-i',mediaPath,'-f','null','-'],{stdio:['ignore','ignore','pipe']});
 }catch(error){await fs.rm(mediaPath,{force:true});throw error;}
 if(mediaPath!==target)await fs.rename(mediaPath,target);
 const stream=probe.streams.find(x=>x.codec_type==='video');
 const duration=Number(probe.format.duration);
 const poster=`posters/${s.id}_${s.slug}.jpg`;
 const strip=`qa/${s.id}_${s.slug}_frames.jpg`;
 execFileSync('ffmpeg',['-v','error','-y','-ss','1.5','-i',target,'-frames:v','1','-vf','scale=960:-2','-q:v','2',path.join(root,poster)],{stdio:['ignore','ignore','pipe']});
 execFileSync('ffmpeg',['-v','error','-y','-i',target,'-vf','fps=1,scale=480:-2,tile=4x1','-frames:v','1','-q:v','2',path.join(root,strip)],{stdio:['ignore','ignore','pipe']});
 const bytes=await fs.readFile(target);
 const entry={id:s.id,title:s.title,file:s.video,model:job.model??'seedance1_5',job_id:job.job_id,width:stream.width,height:stream.height,duration,fps:stream.avg_frame_rate,codec:stream.codec_name,pixel_format:stream.pix_fmt,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),decode_check:'passed',poster,review_strip:strip};
 checks.push(entry);
 Object.assign(s,{generation:{model:'seedance1_5',name:'Seedance 1.5 Pro',job_id:job.job_id,requested_duration:4,requested_resolution:'1080p',quoted_credits:12},actual_video:entry,poster});
 console.log(`${s.id}: ${stream.width}x${stream.height}, ${duration.toFixed(3)}s, all frames decode`);
}
plan.generation_status='completed';
plan.planned_credit_cost=60;
await fs.writeFile(path.join(root,'scenario-plan.json'),JSON.stringify(plan,null,2));
await fs.writeFile(path.join(root,'qa/video-validation.json'),JSON.stringify({validated_at:new Date().toISOString(),checks},null,2));

const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=plan.scenarios.map(s=>`<article><div class="number">SCENARIO ${s.id}</div><h2>${esc(s.title)}</h2><p>${esc(s.description)}</p><video controls playsinline preload="metadata" poster="${s.poster}" aria-label="${esc(s.title)} preview"><source src="${s.video}" type="video/mp4"></video><div class="meta">Seedance 1.5 Pro · ${s.actual_video.duration.toFixed(2)} seconds · 1920 × 1080</div><div class="downloads"><a class="primary" href="${s.video}" download>Download video</a><a href="${s.guidance}" download>Guidance TXT</a><a href="${s.seedance_prompt}" download>Seedance prompt</a><a href="${s.gemini_generation_prompt}" download>Gemini video prompt</a><a href="${s.gemini_analysis_prompt}" download>Gemini analysis prompt</a></div></article>`).join('\n');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Process Guide — Five process scenes</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f7;color:#142d39;font:16px/1.55 system-ui,sans-serif}header{padding:56px max(24px,calc((100vw - 1200px)/2));background:#0a1c29;color:#f3f6f7}.eyebrow{color:#9be2dd;font-size:13px;font-weight:650;letter-spacing:.14em}h1{font-size:clamp(34px,5vw,58px);line-height:1.06;max-width:800px;margin:16px 0}header p{max-width:780px;color:#c0d3da;font-size:18px}main{max-width:1250px;margin:30px auto;padding:0 24px 48px}.note{background:#e4eeef;border:1px solid #c6dddd;padding:20px;border-radius:12px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}article{background:#fff;border:1px solid #d7e2e6;border-radius:16px;padding:24px;overflow:hidden}.number{color:#0e7d8e;letter-spacing:.1em;font-size:12px;font-weight:700}h2{font-size:25px;line-height:1.2;margin:10px 0}article p{color:#526a77;min-height:72px}video{width:100%;aspect-ratio:16/9;background:#0a1c29;border-radius:10px;object-fit:contain}.meta{font-size:13px;color:#58717d;margin:10px 0 16px}.downloads{display:flex;flex-wrap:wrap;gap:8px}a{color:#0e6675;text-decoration:none;border:1px solid #c9dde1;border-radius:8px;padding:10px 12px;font-size:14px;min-height:44px;display:inline-flex;align-items:center}.primary{background:#0e7d8e;color:white;border-color:#0e7d8e}a:focus-visible,video:focus-visible{outline:3px solid #ce8a16;outline-offset:3px}footer{padding:25px 0;color:#526a77;font-size:14px}.hero-link{color:#cdf4ef;border-color:#456771}article:last-child{grid-column:1/-1;max-width:610px} @media(max-width:760px){header{padding:36px 22px}.grid{grid-template-columns:1fr}article{padding:20px}article p{min-height:0}article:last-child{grid-column:auto;max-width:none}main{padding:0 18px 30px}}</style></head><body><header><div class="eyebrow">PROCESS GUIDE · SCENARIO LIBRARY</div><h1>Five processes.<br>One guidance workspace.</h1><p>Generated scene previews, uploadable guidance documents, and editable Seedance and Gemini prompts.</p><a class="hero-link" href="process-guide-scenarios.zip" download>Download the full scenario pack</a></header><main><div class="note"><strong>Use each matched pair.</strong> Upload a video and the guidance TXT with the same number to <a class="app-link" href="/">Process Guide</a>. These are four-second visual previews; the guides describe a longer process, so unshown steps stay unobserved. The surgery scene is a nonpatient training simulation. Review AI-generated motion before using the clips in a demonstration.</div><div class="grid">${cards}</div><footer>Google prompts are prepared for generation or analysis; they have not been run. All five guidance documents were checked with the app’s parser.</footer></main><script>if(location.protocol==="file:"){document.querySelector(".hero-link").remove();document.querySelector(".app-link").href="http://localhost:8101/";}</script></body></html>`;
await fs.writeFile(path.join(root,'index.html'),html);
const out=path.join(appRoot,'output','scenarios');await fs.mkdir(out,{recursive:true});
const zipPath=path.join(out,'process-guide-scenarios.zip');
try{await fs.unlink(zipPath);}catch(e){if(e.code!=='ENOENT')throw e;}
execFileSync('zip',['-q','-r',zipPath,'guidance','prompts','videos','posters','qa','README.txt','scenario-plan.json','index.html'],{cwd:root});
execFileSync('unzip',['-tq',zipPath],{stdio:['ignore','ignore','pipe']});
for(const folder of ['frontend/public/media/process-guide-scenarios','frontend/dist/media/process-guide-scenarios']){
 const target=path.join(appRoot,folder);await fs.mkdir(target,{recursive:true});
 for(const item of ['guidance','prompts','videos','posters','qa','README.txt','scenario-plan.json','index.html'])await fs.cp(path.join(root,item),path.join(target,item),{recursive:true,force:true});
 await fs.copyFile(zipPath,path.join(target,'process-guide-scenarios.zip'));
}
console.log(`Pack ready: ${zipPath}`);
