import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {chromium} from '../../frontend/node_modules/@playwright/test/index.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'scenarios');
const plan=JSON.parse(await fs.readFile(path.join(root,'scenario-plan.json'),'utf8'));
const base='http://127.0.0.1:8101/media/process-guide-scenarios/';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
async function checkPlayback(page){
 for(const video of await page.locator('video').all()){
  await video.evaluate(async el=>{el.currentTime=0;el.muted=true;await el.play();});
  await page.waitForFunction(index=>document.querySelectorAll('video')[index].currentTime>0.15,await video.evaluate(el=>[...document.querySelectorAll('video')].indexOf(el)));
  await video.evaluate(el=>el.pause());
 }
}
try{
 for(const viewport of [{width:1440,height:1000},{width:768,height:1024},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(base+'index.html',{waitUntil:'networkidle'});
  if(response?.status()!==200)throw Error('Gallery HTTP failure');
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].length===5&&[...document.querySelectorAll('video')].every(v=>v.readyState>=1));
  const data=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>window.innerWidth+1,videos:[...document.querySelectorAll('video')].map(v=>({width:v.videoWidth,height:v.videoHeight,duration:v.duration,error:v.error?.message??null})),links:[...document.querySelectorAll('a[download]')].map(a=>a.href)}));
  if(data.overflow||data.videos.some(v=>v.width!==1920||v.height!==1080||v.error)||errors.length)throw Error('Gallery layout/media failure '+JSON.stringify({viewport,...data,errors}));
  if(viewport.width===1440){
   const checks=await Promise.all(data.links.map(async url=>{const res=await fetch(url,{method:'HEAD'});const type=res.headers.get('content-type')||'';const expected=url.endsWith('.mp4')?'video/mp4':url.endsWith('.zip')?'application/zip':'text/plain';return{url,status:res.status,content_type:type,expected_type:expected,size:Number(res.headers.get('content-length'))};}));
   if(checks.some(c=>c.status!==200||!c.content_type.includes(c.expected_type)||c.size<=0))throw Error('Broken download link: '+JSON.stringify(checks));
   results.push({viewport,overflow:data.overflow,video_count:data.videos.length,working_downloads:checks.length,playback:'passed for all five',errors});
  }else results.push({viewport,overflow:data.overflow,video_count:data.videos.length,playback:'passed for all five',errors});
  await checkPlayback(page);
  if(errors.length||await page.locator('video').evaluateAll(videos=>videos.some(v=>!!v.error)))throw Error('Playback produced browser/media errors: '+JSON.stringify(errors));
  await page.screenshot({path:path.join(root,'qa',`gallery-${viewport.width}.png`),fullPage:true});
  await page.close();
 }
 for(const s of plan.scenarios){
  const response=await fetch(base+s.video,{headers:{Range:'bytes=0-1023'}});
  if(response.status!==206)throw Error(`Missing range support ${s.id}: ${response.status}`);
  if(!(response.headers.get('content-type')||'').includes('video/mp4'))throw Error('Unexpected video content type');
 }
 const offlineRoot=await fs.mkdtemp(path.join(os.tmpdir(),'process-guide-scenarios-'));
 try{
  execFileSync('unzip',['-q',path.resolve(root,'../../../output/scenarios/process-guide-scenarios.zip'),'-d',offlineRoot]);
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const offlineErrors=[];page.on('pageerror',e=>offlineErrors.push(e.message));
  await page.goto(pathToFileURL(path.join(offlineRoot,'index.html')).href);
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].length===5&&[...document.querySelectorAll('video')].every(v=>v.readyState>=1));
  const offline=await page.evaluate(()=>({zipLink:!!document.querySelector('.hero-link'),appLink:document.querySelector('.app-link').href,overflow:document.documentElement.scrollWidth>innerWidth+1,downloads:[...document.querySelectorAll('a[download]')].map(a=>a.href),videos:[...document.querySelectorAll('video')].map(v=>({width:v.videoWidth,height:v.videoHeight,error:v.error?.message??null}))}));
  if(offline.zipLink||offline.appLink!=='http://localhost:8101/'||offline.overflow||offline.videos.some(v=>v.width!==1920||v.height!==1080||v.error))throw Error('Offline pack layout/media failure');
  for(const url of offline.downloads)await fs.access(fileURLToPath(url));
  await checkPlayback(page);
  if(offlineErrors.length||await page.locator('video').evaluateAll(videos=>videos.some(v=>!!v.error)))throw Error('Offline playback produced browser/media errors');
  await page.close();
  results.push({offline_pack:'passed',viewport:{width:390,height:844},video_count:5,working_downloads:offline.downloads.length,playback:'passed for all five'});
 }finally{await fs.rm(offlineRoot,{recursive:true,force:true});}
 const out={validated_at:new Date().toISOString(),gallery:base+'index.html',results,range_streaming:'passed for all five MP4s'};
 await fs.writeFile(path.join(root,'qa/gallery-validation.json'),JSON.stringify(out,null,2));
 console.log(JSON.stringify(out,null,2));
}finally{await browser.close();}
