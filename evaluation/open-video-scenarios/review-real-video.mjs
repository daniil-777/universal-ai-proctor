import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import sharp from '../../backend/node_modules/sharp/dist/index.mjs';

const [id, file, intervalArg='5']=process.argv.slice(2);
if(!/^\d{2}[-a-z]*$/.test(id??'')||!file)throw Error('Usage: node review-real-video.mjs ID FILE [INTERVAL_S]');
const interval=Number(intervalArg);
if(!Number.isFinite(interval)||interval<=0)throw Error('Invalid interval');
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',file],{encoding:'utf8'}));
const duration=Number(probe.format.duration);
if(!Number.isFinite(duration)||duration<=0)throw Error('Invalid source duration');
const maxFrames=Math.ceil(duration/interval);
const folder=path.join('frames',id);
await fs.mkdir(folder,{recursive:true});
const result=spawnSync('ffmpeg',['-hide_banner','-y','-i',file,'-vf',"select='isnan(prev_selected_t)+gte(t,prev_selected_t+"+interval+")',showinfo,scale=320:-2",'-fps_mode','vfr','-frames:v',String(maxFrames),path.join(folder,'frame-%03d.jpg')],{encoding:'utf8',maxBuffer:8*1024*1024});
if(result.status!==0)throw Error(result.stderr);
const times=[...result.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(m=>Number(m[1]));
const files=(await fs.readdir(folder)).filter(f=>/^frame-\d+\.jpg$/.test(f)).sort().slice(0,times.length);
if(files.length!==times.length||!files.length)throw Error('Frame/time mismatch');
const columns=6, tileW=320, imageH=182, tileH=206;
const rows=Math.ceil(files.length/columns);
const layers=[];
for(let i=0;i<files.length;i++){
 const frame=await sharp(path.join(folder,files[i])).resize({width:tileW,height:imageH,fit:'contain',background:'#091c28'}).toBuffer();
 const t=times[i]; const label=String(Math.floor(t/60)).padStart(2,'0')+':'+(t%60).toFixed(1).padStart(4,'0');
 const svg=Buffer.from('<svg width="320" height="24"><text x="6" y="19" fill="white" font-family="Arial,sans-serif" font-size="18">'+label+'</text></svg>');
 const x=(i%columns)*tileW,y=Math.floor(i/columns)*tileH;
 layers.push({input:frame,left:x,top:y},{input:svg,left:x,top:y+imageH});
}
const sheet=path.join('frames',id+'-overview.jpg');
await sharp({create:{width:columns*tileW,height:rows*tileH,channels:3,background:'#091c28'}}).composite(layers).jpeg({quality:90}).toFile(sheet);
await fs.writeFile(path.join('evidence',id+'-review-frame-times.json'),JSON.stringify({file,duration,interval_s:interval,times,review_sheet:sheet},null,2));
console.log(JSON.stringify({frames:files.length,first:times[0],last:times.at(-1),sheet}));
