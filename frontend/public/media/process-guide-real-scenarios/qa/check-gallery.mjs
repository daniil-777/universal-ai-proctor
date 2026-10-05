import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from '../../../frontend/node_modules/@playwright/test/index.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const qa=path.join(root,'qa');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const base='http://127.0.0.1:8101/media/process-guide-real-scenarios/';
const zip=path.resolve(root,'../../output/scenarios/process-guide-real-scenarios.zip');
const results=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
let offlineRoot,failure;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function inspect(page){
  await page.waitForFunction(()=>document.querySelectorAll('video').length===5&&[...document.querySelectorAll('video')].every(v=>v.readyState>=1),null,{timeout:20000});
  const data=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,videos:[...document.querySelectorAll('video')].map(v=>({source:v.currentSrc,width:v.videoWidth,height:v.videoHeight,duration:v.duration,error:v.error?.message??null})),links:[...document.querySelectorAll('a[download]')].map(a=>a.href)}));
  assert(!data.overflow,'Horizontal overflow');
  data.videos.forEach((v,i)=>{const s=manifest.scenarios[i];assert(v.width===s.native_dimensions.width&&v.height===s.native_dimensions.height,`Native dimensions mismatch ${s.id}: ${v.width}x${v.height}`);assert(v.duration>=120&&v.duration<=180.05&&Math.abs(v.duration-s.duration_s)<0.1,`Duration mismatch ${s.id}: ${v.duration}`);assert(!v.error,`Media error ${s.id}: ${v.error}`);});
  return data;
}
async function playback(page){
  const played=[];
  for(let i=0;i<manifest.scenarios.length;i++){
    const v=page.locator('video').nth(i);
    await v.evaluate(async el=>{el.muted=true;el.currentTime=0;await el.play();});
    await page.waitForFunction(i=>document.querySelectorAll('video')[i].currentTime>0.2,i,{timeout:15000});
    await v.evaluate(el=>el.pause());
    await v.evaluate(el=>{el.currentTime=el.duration/2;});
    await page.waitForFunction(i=>{const v=document.querySelectorAll('video')[i];return !v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-v.duration/2)<0.2;},i,{timeout:15000});
    assert(!(await v.evaluate(el=>el.error?.message??null)),`Playback/seek error ${manifest.scenarios[i].id}`);
    played.push({id:manifest.scenarios[i].id,initial_playback:'passed',midpoint_seek:'passed'});
  }
  return played;
}
try{
  for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:320,height:844}]){
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(base+'index.html',{waitUntil:'networkidle',timeout:25000});assert(response?.status()===200,'Gallery HTTP failure');
    const data=await inspect(page);
    if(viewport.width===1440){
      const downloads=await Promise.all(data.links.map(async url=>{const response=await fetch(url,{method:'HEAD'});const extension=new URL(url).pathname.split('.').at(-1);const expected={mp4:'video/mp4',zip:'application/zip',json:'application/json',txt:'text/plain'}[extension];return{url,status:response.status,type:response.headers.get('content-type'),expected,bytes:Number(response.headers.get('content-length'))};}));
      assert(downloads.every(d=>d.status===200&&d.expected&&d.type?.includes(d.expected)&&d.bytes>0),'Download HEAD/MIME failure: '+JSON.stringify(downloads));
      results.push({download_headers:downloads});
    }
    const played=await playback(page);assert(!errors.length,'Browser errors: '+errors.join('; '));
    await page.screenshot({path:path.join(qa,`real-gallery-${viewport.width}.png`),fullPage:true});
    results.push({surface:'live',viewport,overflow:data.overflow,videos:data.videos,played,errors});await page.close();
  }
  const ranges=[];
  for(const s of manifest.scenarios){const response=await fetch(base+s.video,{headers:{Range:'bytes=0-1023'}});const body=await response.arrayBuffer();const r={id:s.id,status:response.status,type:response.headers.get('content-type'),content_range:response.headers.get('content-range'),bytes:body.byteLength};assert(r.status===206&&r.type?.includes('video/mp4')&&r.content_range?.startsWith('bytes 0-1023/')&&r.bytes===1024,'Range streaming failure: '+JSON.stringify(r));ranges.push(r);}
  results.push({range_streaming:ranges});
  const integrity=execFileSync('unzip',['-t',zip],{encoding:'utf8',maxBuffer:2*1024*1024});assert(integrity.includes('No errors detected'),'ZIP integrity failure');
  offlineRoot=await fs.mkdtemp(path.join(os.tmpdir(),'process-guide-real-gallery-'));
  execFileSync('unzip',['-q',zip,'-d',offlineRoot]);
  const offlineHashes=[];
  for(const s of manifest.scenarios){const data=await fs.readFile(path.join(offlineRoot,s.video));const sha256=createHash('sha256').update(data).digest('hex');assert(sha256===s.sha256&&data.length===s.bytes,`Offline video hash/size mismatch ${s.id}`);offlineHashes.push({id:s.id,bytes:data.length,sha256});}
  const page=await browser.newPage({viewport:{width:320,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(offlineRoot,'index.html')).href,{waitUntil:'networkidle'});const data=await inspect(page);
  const offline=await page.evaluate(()=>({pack_link:!!document.querySelector('.pack-link'),app_link:document.querySelector('.app-link')?.href,archive_link:!!document.querySelector('.archive-link')}));
  assert(!offline.pack_link&&!offline.archive_link&&offline.app_link==='http://localhost:8101/','Offline navigation failure: '+JSON.stringify(offline));
  for(const url of data.links)await fs.access(fileURLToPath(url));
  const played=await playback(page);assert(!errors.length,'Offline browser errors: '+errors.join('; '));
  await page.screenshot({path:path.join(qa,'real-gallery-offline-320.png'),fullPage:true});await page.close();
  results.push({surface:'offline_zip',zip,integrity:'passed',hashes:offlineHashes,viewport:{width:320,height:844},overflow:data.overflow,working_downloads:data.links.length,navigation:offline,videos:data.videos,played,errors});
}catch(error){failure={message:error.message,stack:error.stack};}
finally{
  await browser.close();if(offlineRoot)await fs.rm(offlineRoot,{recursive:true,force:true});
  const report={validated_at:new Date().toISOString(),gallery:base+'index.html',status:failure?'failed':'passed',results,...(failure?{failure}:{})};
  await fs.writeFile(path.join(qa,'real-gallery-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failure)process.exitCode=1;
}
