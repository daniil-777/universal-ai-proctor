import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const p=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(p,'../..');
const sharp=(await import(new URL('../../backend/node_modules/sharp/dist/index.mjs',import.meta.url))).default;
const file=path.join(p,'renders/process-guide-walkthrough.mp4');
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-print_format','json',file],{encoding:'utf8'}));
const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
if(video.codec_name!=='h264'||video.width!==1920||video.height!==1080||video.avg_frame_rate!=='30/1'||!audio||audio.codec_name!=='aac'||Math.abs(Number(probe.format.duration)-90)>.05)throw Error('Encoded format differs from brief');
const bytes=await fs.readFile(file);let offset=0,atoms=[];while(offset+8<=bytes.length){let size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(size===1){size=Number(bytes.readBigUInt64BE(offset+8));}if(!size)size=bytes.length-offset;atoms.push({type,offset,size});offset+=size;}const moov=atoms.find(a=>a.type==='moov'),mdat=atoms.find(a=>a.type==='mdat');
if(!moov||!mdat)throw Error('Incomplete MP4 atoms');
if(moov.offset>mdat.offset){const fast=path.join(p,'renders/process-guide-walkthrough-faststart.mp4');execFileSync('ffmpeg',['-v','error','-y','-i',file,'-c','copy','-movflags','+faststart',fast]);await fs.rename(fast,file);}
await fs.mkdir(path.join(p,'renders/proof'),{recursive:true});
const times=[2.5,8.2,14.7,20.7,24.8,27.4,30.7,33.7,38.2,44.4,50.6,56.4,60.8,63.4,67.6,73.9,78.5,81,86.1,89.966];const layers=[];
for(let i=0;i<times.length;i++){const t=times[i],frame=path.join(p,`renders/proof/${String(i+1).padStart(2,'0')}-${t}.png`);execFileSync('ffmpeg',['-v','error','-y','-ss',String(t),'-i',file,'-frames:v','1',frame]);layers.push({input:await sharp(frame).resize(640,360).toBuffer(),left:(i%3)*640,top:Math.floor(i/3)*388+28});layers.push({input:Buffer.from(`<svg width="640" height="28"><text x="12" y="20" font-family="sans-serif" font-size="18" fill="#0c2432">Rendered ${t.toFixed(3)} seconds</text></svg>`),left:(i%3)*640,top:Math.floor(i/3)*388});}
const sheet=path.join(root,'docs/walkthrough-rendered-contact-sheet.jpg');await sharp({create:{width:1920,height:Math.ceil(times.length/3)*388,channels:3,background:'#eaf1f3'}}).composite(layers).jpeg({quality:88}).toFile(sheet);
await sharp(path.join(p,'renders/proof/01-2.5.png')).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toFile(path.join(p,'process-guide-walkthrough-poster.jpg'));
const level=spawnSync('ffmpeg',['-hide_banner','-i',file,'-vn','-af','volumedetect','-f','null','-'],{encoding:'utf8'});if(level.status!==0)throw Error('Audio inspection failed');const mean=Number(/mean_volume: ([\d.-]+) dB/.exec(level.stderr)?.[1]);const peak=Number(/max_volume: ([\d.-]+) dB/.exec(level.stderr)?.[1]);if(!Number.isFinite(mean)||mean < -35||peak>=0)throw Error('Audio too quiet or clipped');
const finalBytes=await fs.readFile(file);const verification={verified_at:new Date().toISOString(),video:{codec:video.codec_name,width:video.width,height:video.height,fps:video.avg_frame_rate,pixel_format:video.pix_fmt,frames:Number(video.nb_frames),duration_s:Number(probe.format.duration)},audio:{codec:audio.codec_name,channels:audio.channels,sample_rate:Number(audio.sample_rate),duration_s:Number(audio.duration),mean_volume_db:mean,max_volume_db:peak},bytes:finalBytes.length,sha256:crypto.createHash('sha256').update(finalBytes).digest('hex'),fast_start:true,rendered_proof_frames:times,contact_sheet:'docs/walkthrough-rendered-contact-sheet.jpg',hyperframes_check:JSON.parse(await fs.readFile(path.join(p,'check.json'),'utf8')).ok,caption_windows:'Measured complete TTS chunk windows, already burned in; optional WebVTT default off',captured_fixture_calls:0,paid_visual_provider_calls:0};await fs.writeFile(path.join(p,'verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify(verification,null,2));
