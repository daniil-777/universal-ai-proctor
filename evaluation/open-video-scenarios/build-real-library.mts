import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseDocument} from '../../backend/src/domain/guidance.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const appRoot=path.resolve(root,'../..');
const plan=JSON.parse(await fs.readFile(path.join(root,'library-plan.json'),'utf8'));
if(plan.length!==5)throw Error('Five matched real scenarios required');
await fs.mkdir(path.join(root,'posters'),{recursive:true});
await fs.mkdir(path.join(root,'qa'),{recursive:true});
const validation=[];
const guideTexts=new Map();
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=x=>Math.floor(x/60)+':'+String(Math.floor(x%60)).padStart(2,'0');
for(let i=0;i<plan.length;i++){
 const s=plan[i]; const media=path.join(root,'videos',s.filename);
 const text=await fs.readFile(path.join(root,'guidance',s.guidance),'utf8');
 guideTexts.set(s.id,text);
 const {workflow}=parseDocument(s.guidance,text);
 if(workflow.warnings.length||workflow.steps.length<4||workflow.steps.some(step=>step.complete||step.progress!==0||step.confidence!==0||!step.name||step.criteria.length<2||step.criteria.some(c=>c.status!=='unknown'||(c.confidence??0)!==0)))throw Error('Guidance validation failed: '+s.id);
 if(!text.includes(s.author)||!text.includes(s.source_url)||!text.includes(s.license_url.replace(/\/$/,'')))throw Error('Missing guide attribution: '+s.id);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',media],{encoding:'utf8'}));
 const stream=probe.streams.find(x=>x.codec_type==='video');
 const duration=Number(probe.format.duration);
 if(!Number.isFinite(duration)||duration<120||duration>180.05||stream.codec_name!=='h264'||stream.pix_fmt!=='yuv420p')throw Error('Unexpected video format/duration: '+s.id);
 const bytes=await fs.readFile(media);
 s.duration_s=duration;s.bytes=bytes.length;s.sha256=createHash('sha256').update(bytes).digest('hex');
 s.native_dimensions={width:stream.width,height:stream.height};
 s.video='videos/'+s.filename;s.guidance_file='guidance/'+s.guidance;
 s.poster='posters/'+s.id+'.jpg';
 const posterTime=i===2?0:i===3?12:i===4?42:Math.min(12,duration/2);
 execFileSync('ffmpeg',['-v','error','-y','-ss',String(posterTime),'-i',media,'-frames:v','1','-vf','scale=min(960\\,iw):-2','-q:v','2',path.join(root,s.poster)],{stdio:['ignore','ignore','pipe']});
 s.guidance_steps=workflow.steps.length;
 s.guidance_criteria=workflow.steps.reduce((n,step)=>n+step.criteria.length,0);
 validation.push({id:s.id,file:s.guidance,steps:workflow.steps.length,criteria:s.guidance_criteria,principles:workflow.principles.length,warnings:workflow.warnings,step_names:workflow.steps.map(x=>x.name),all_initial_steps_incomplete:true,all_initial_criteria_unknown:true,duration_s:duration,native_dimensions:s.native_dimensions,video_sha256:s.sha256});
 for(const [src,dest] of [[media,path.join(appRoot,'sample-videos',s.filename)],[path.join(root,'guidance',s.guidance),path.join(appRoot,'guidance-library',s.guidance)]]){
  await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(src,dest+'.pending');await fs.rename(dest+'.pending',dest);
 }
}
const fields=['id','name','filename','guidance','description','default','duration_s','bytes','source_url','author','license','license_url','excerpt','changes'];
const catalog=plan.map(s=>Object.fromEntries(fields.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])));
await fs.writeFile(path.join(appRoot,'backend/src/media/realScenarioSamples.ts'),"import type {SampleVideoDefinition} from './sampleVideo.js';\n\n// Verified bundled sources; source URLs are attribution only, never runtime fetches.\nexport const REAL_SCENARIO_SAMPLES: readonly SampleVideoDefinition[] = "+JSON.stringify(catalog,null,2)+";\n");
const manifest={prepared_at:new Date().toISOString(),kind:'real openly licensed educational footage',source_speed_preserved:true,scenarios:plan};
await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(root,'qa/parser-and-media-validation.json'),JSON.stringify({validated_at:new Date().toISOString(),documents:validation,total_steps:validation.reduce((n,x)=>n+x.steps,0),total_criteria:validation.reduce((n,x)=>n+x.criteria,0)},null,2));
const license='PROCESS GUIDE — SOURCE VIDEO CREDITS AND LICENSES\n\nSource authors do not endorse Process Guide. Each video, its transcode, poster and extracted review frames retain the stated source license. This pack is a collection of separate works, not a new exclusive license on the footage. Preserve these credits and links when redistributing.\n\n'+plan.map(s=>s.name+'\nAuthor: '+s.author+'\nSource: '+s.source_url+'\nLicense: '+s.license+' — '+s.license_url+'\nChanges: '+s.changes+'\nDelivered file: '+s.filename+'\nSHA-256: '+s.sha256).join('\n\n')+'\n\nThe tap video adaptation and associated extracted frames retain CC BY-SA 4.0. Share derivative versions of that video under the same or compatible license. No source author endorsement is implied.\n';
await fs.writeFile(path.join(root,'SOURCE_LICENSES.txt'),license);
const readme='PROCESS GUIDE — REAL 2–3 MINUTE VIDEO LIBRARY\n\nHOW TO USE\nOpen http://localhost:8101 and choose a real video from the sample-video menu. It loads the matching reference automatically. Alternatively upload an MP4 and the TXT with the same scenario name. Steps and principles appear in the guidance workspace.\n\nThe five guidance documents are original observation references written after reviewing the actual footage and its source context. Timestamps are approximate review anchors, not automatic completion. The guides separate visible actions from measurements, approval, comfort, clinical outcomes and off-camera activity.\n\nCONTENTS\n'+plan.map(s=>s.name+' — '+clock(s.duration_s)+' — '+s.native_dimensions.width+'x'+s.native_dimensions.height+' — '+s.guidance_steps+' steps').join('\n')+'\n\nNOTES\nHouse: source 01:20–04:20, original timelapse/editing preserved.\nManufacturing: full company film, multiple jobs and montage cuts.\nSurgery: first 180 seconds of published real operative footage; educational observation with surgeon review. No audible narration. Native source is 480x272.\nDancing: full tap-footwork source; upper body largely cropped, native428x240. Playable packet timeline differs slightly from container duration tag.\nSport: full official Commons1080p derivative after original download was rate-limited; explanation and demonstration scenes are distinguished in the guide.\n\nNo video is looped, stretched, generated or artificially upscaled. Native high-resolution downloads can be large. The gallery uses metadata-only preload; individual files can be downloaded separately.\n\nVERIFICATION\nAll five references parse with the app parser into incomplete steps and unknown criteria. Source author, license and change records are retained. Clips are H.264/AAC browser-compatible MP4s; full decoder, app catalog/loading, streaming and responsive browser results are recorded in qa/evidence as available. These checks are not a benchmark of AI accuracy or clinical validation.\n\nOriginal default surgical guidance and the earlier generated clips are preserved. \n\nRead SOURCE_LICENSES.txt before redistributing, including the tap footage share-alike terms.\n';
await fs.writeFile(path.join(root,'README.txt'),readme);
const cards=plan.map((s,i)=>'<article><div class="number">SCENARIO '+String(i+1).padStart(2,'0')+'</div><h2>'+esc(s.name)+'</h2><p>'+esc(s.description)+'</p><video controls playsinline preload="metadata" poster="'+esc(s.poster)+'" aria-label="'+esc(s.name)+'"><source src="'+esc(s.video)+'" type="video/mp4"></video><div class="meta">'+clock(s.duration_s)+' · '+s.native_dimensions.width+' × '+s.native_dimensions.height+' · '+s.guidance_steps+' guidance steps · '+Math.round(s.bytes/1024/1024)+' MB</div><div class="downloads"><a class="primary" href="'+s.video+'" download>Download video</a><a href="'+s.guidance_file+'" download>Guidance TXT</a></div><details class="instructions"><summary>Read instructions</summary><pre>'+esc(guideTexts.get(s.id))+'</pre></details><div class="credit"><p>Video by '+esc(s.author)+' · '+esc(s.license)+'</p><p>'+esc(s.changes)+'</p><a href="'+esc(s.source_url)+'" target="_blank" rel="noopener noreferrer">Original source</a> <a href="'+esc(s.license_url)+'" target="_blank" rel="noopener noreferrer">Video license</a></div></article>').join('\n');
const html=(await fs.readFile(path.join(root,'gallery.template.html'),'utf8')).replace('{{CARDS}}',cards);
await fs.writeFile(path.join(root,'index.html'),html);
console.log(JSON.stringify({scenarios:plan.length,steps:validation.reduce((n,x)=>n+x.steps,0),criteria:validation.reduce((n,x)=>n+x.criteria,0),catalog_staged:true},null,2));
