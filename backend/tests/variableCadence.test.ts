import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {sampleWindowFramesFast} from '../src/pipeline/frames.js';
describe('variable-cadence displayed-frame sampling',()=>{
 it('retains the currently held image at fresh display timestamps without selecting the future image',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'proctor-vfr-'));
  try{
   const file=path.join(dir,'sparse.mp4');
   execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=96x64:rate=25:duration=6','-vf',"select='eq(n,0)+eq(n,50)+eq(n,100)+eq(n,149)'",'-fps_mode','vfr','-c:v','libx264','-pix_fmt','yuv420p',file],{stdio:'pipe'});
   let times:number[]=[];
   const frames=await sampleWindowFramesFast(file,1,3,4,{recentMotion:true,onSampleTimes:value=>times=value});
   const held=await sampleWindowFramesFast(file,2,2.04,1,{recentMotion:true});
   const future=await sampleWindowFramesFast(file,4,4.04,1,{recentMotion:true});
   const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
   expect(frames.length).toBeGreaterThanOrEqual(3);
   expect(times.at(-1)).toBeGreaterThanOrEqual(2.9);
   expect(times.every(t=>t<=3.05)).toBe(true);
   expect(hash(frames.at(-1)!)).toBe(hash(held[0]!));
   expect(hash(frames.at(-1)!)).not.toBe(hash(future[0]!));
   expect(new Set(frames.slice(-3).map(hash)).size).toBe(1);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 },15000);
});

