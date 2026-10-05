import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const project=path.dirname(fileURLToPath(import.meta.url));
const root=path.join(project,'scenarios');
const appRoot=path.resolve(project,'../..');
const items=['guidance','prompts','videos','posters','qa','README.txt','scenario-plan.json','index.html'];
const plan=JSON.parse(await fs.readFile(path.join(root,'scenario-plan.json'),'utf8'));
if(plan.generation_status!=='completed'||plan.scenarios.length!==5)throw Error('Five completed scenarios are required.');
for(const item of items)await fs.access(path.join(root,item));
const out=path.join(appRoot,'output','scenarios');
await fs.mkdir(out,{recursive:true});
const zipPath=path.join(out,'process-guide-scenarios.zip');
await fs.rm(zipPath,{force:true});
execFileSync('zip',['-q','-r',zipPath,...items],{cwd:root});
execFileSync('unzip',['-tq',zipPath],{stdio:['ignore','ignore','pipe']});
for(const folder of ['frontend/public/media/process-guide-scenarios','frontend/dist/media/process-guide-scenarios']){
 const target=path.join(appRoot,folder);
 await fs.mkdir(target,{recursive:true});
 for(const item of items)await fs.cp(path.join(root,item),path.join(target,item),{recursive:true,force:true});
 await fs.copyFile(zipPath,path.join(target,'process-guide-scenarios.zip'));
}
console.log('Updated scenario pack and local gallery: '+zipPath);
