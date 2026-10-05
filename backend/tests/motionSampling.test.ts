import {describe,it,expect} from 'vitest';
import {windowSampleIndices} from '../src/pipeline/frames.js';
import {parseDocument,ObservationSchema} from '../src/domain/guidance.js';
import {mergeObservation} from '../src/domain/progress.js';
describe('motion sampling and ambiguous phase evidence',()=>{
 it('keeps one old context and three fresh samples with the same four-image budget',()=>{
  expect(windowSampleIndices(150,30,4,true)).toEqual([0,125,137,149]);
 });
 it('uses the current frame when a caller requests only one image',()=>{
  expect(windowSampleIndices(150,30,1,true)).toEqual([149]);
 });
 it('preserves chronological distinct samples, budget and latest image for short clips and several frame rates',()=>{
  for(const fps of [12,25,30,60])for(const count of [2,3,4,6,9])for(const frames of [1,5,25,150]){
   const indices=windowSampleIndices(frames,fps,count,true);
   expect(indices.length).toBeLessThanOrEqual(Math.min(count,frames));
   expect(new Set(indices).size).toBe(indices.length);
   expect(indices.at(-1)).toBe(frames-1);
   expect(indices.every((x,i)=>x>=0&&x<frames&&(i===0||x>indices[i-1]!))).toBe(true);
  }
 });
 it('does not label the first unfinished step as visually recognized when phase identity is explicitly unknown',()=>{
  const {workflow}=parseDocument('ambiguous.txt','Principles:\n- Review actual evidence.\nStep 1: Lift\nActions:\n- Observe lift.\nCriteria:\n- A shoe is visible.\nStep 2: Later lift\nActions:\n- Observe a later lift.\nCriteria:\n- A shoe is visible.');
  const observation=ObservationSchema.parse({summary:'A shoe is visible but the repeated phase is unclear.',guidance:'Review the distinguishing camera and motion cues.',current_step_id:null,steps:[]});
  const r=mergeObservation(workflow,observation,5,new Map(),[{hash:'actual',time:5}]);
  expect(r.currentId).toBe('');
  expect(r.workflow.steps.every(s=>s.progress===0&&!s.complete)).toBe(true);
 });
});

