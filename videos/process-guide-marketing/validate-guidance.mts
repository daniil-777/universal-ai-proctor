import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {parseDocument} from '../../backend/src/domain/guidance.js';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'scenarios');
const expected=[5,4,5,4,5];
const names=(await fs.readdir(path.join(root,'guidance'))).filter(n=>n.endsWith('.txt')).sort();
assert.equal(names.length,5,'All five guidance files are required');
const documents=[];
for(const [index,file] of names.entries()){
 const text=await fs.readFile(path.join(root,'guidance',file),'utf8');
 const {workflow,rows}=parseDocument(file,text);
 assert.equal(workflow.source,'document');
 assert.equal(workflow.steps.length,expected[index]);
 assert.equal(workflow.warnings.length,0);
 assert.ok(workflow.principles.length>=5);
 for(const step of workflow.steps){
  assert.ok(step.name.trim(),'A rendered step name is required');
  assert.ok(step.actions.length>=1);
  assert.ok(step.expectedInstruments.length>=1);
  assert.ok(step.criteria.length>=2);
  assert.equal(step.complete,false);
  assert.equal(step.progress,0);
  assert.equal(step.confidence,0);
  for(const criterion of step.criteria){assert.equal(criterion.status,'unknown');assert.equal(criterion.confidence??0,0);assert.ok(criterion.label.trim());}
 }
 documents.push({file,steps:workflow.steps.length,principles:workflow.principles.length,warnings:workflow.warnings,step_names:workflow.steps.map(s=>s.name),criteria:workflow.steps.map(s=>({step:s.name,count:s.criteria.length,statuses:s.criteria.map(c=>c.status)})),structured_rows:rows.length});
}
const out={validated_at:new Date().toISOString(),total_steps:documents.reduce((n,d)=>n+d.steps,0),documents};
await fs.writeFile(path.join(root,'qa/guidance-parser-validation.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify({documents:documents.length,total_steps:out.total_steps,all_initial_progress:0,all_initial_criteria:'unknown',warnings:0}));
