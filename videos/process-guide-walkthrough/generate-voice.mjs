import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const lines=JSON.parse(await fs.readFile(new URL('./script.json',import.meta.url),'utf8'));
let next=0;
async function worker(){while(next<lines.length){const line=lines[next++];const target=new URL(`./assets/voice/${line.id}.mp3`,import.meta.url);try{await fs.access(target)}catch{const response=await fetch('http://127.0.0.1:8101/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:line.text,voice:'nova'})});if(!response.ok)throw Error(`TTS ${line.id}: HTTP ${response.status}`);await fs.writeFile(target,Buffer.from(await response.arrayBuffer()));}line.duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',fileURLToPath(target)],{encoding:'utf8'}).trim());console.log(`${line.id}: ${line.duration.toFixed(3)} seconds`);}}
await Promise.all([worker(),worker(),worker()]);
await fs.writeFile(new URL('./voice-meta.json',import.meta.url),JSON.stringify({provider:'Process Guide local /api/tts: OpenAI gpt-4o-mini-tts, nova',generated_at:new Date().toISOString(),lines,total_duration:lines.reduce((a,x)=>a+x.duration,0)},null,2));
