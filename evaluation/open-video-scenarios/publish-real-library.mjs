import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const app=path.resolve(root,'../..');
const zip=path.join(app,'output/scenarios/process-guide-real-scenarios.zip');
await fs.mkdir(path.dirname(zip),{recursive:true});
const draftZip=zip+'.pending-'+process.pid+'.zip';
const items=['index.html','manifest.json','README.txt','SOURCE_LICENSES.txt','videos','guidance','posters','qa','evidence'];
try {
 execFileSync('zip',['-q','-r','-0',draftZip,...items,'-x','qa/real-gallery-validation.json'],{cwd:root,stdio:'pipe'});
 execFileSync('unzip',['-tq',draftZip],{stdio:'pipe'});
 await fs.rename(draftZip,zip);
} finally { await fs.rm(draftZip,{force:true}); }
const redirect='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=../process-guide-real-scenarios/index.html"><title>Real process video library</title><p><a href="../process-guide-real-scenarios/index.html">Open the real video and guidance library</a></p></html>';
for(const surface of ['public','dist']){
 const media=path.join(app,'frontend',surface,'media');
 const previous=path.join(media,'process-guide-scenarios');
 const archive=path.join(media,'process-guide-generated-scenarios');
 try{await fs.access(archive);}catch{try{await fs.cp(previous,archive,{recursive:true,filter:source=>!/gemini/i.test(path.basename(source))});}catch{}}
 const dest=path.join(media,'process-guide-real-scenarios');await fs.mkdir(dest,{recursive:true});
 await fs.rm(path.join(dest,'prompts'),{recursive:true,force:true});
 await fs.rm(path.join(dest,'qa/real-gallery-validation.json'),{force:true});
 for(const item of items)await fs.cp(path.join(root,item),path.join(dest,item),{recursive:true,force:true,filter:source=>path.basename(source)!=='real-gallery-validation.json'});
 await fs.copyFile(zip,path.join(dest,path.basename(zip)));
 await fs.mkdir(previous,{recursive:true});await fs.writeFile(path.join(previous,'index.html'),redirect);
}
console.log(JSON.stringify({published:true,zip_bytes:(await fs.stat(zip)).size,zip_integrity:'passed'}));
