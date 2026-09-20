import assert from 'node:assert/strict';
import test from 'node:test';
import {getPulseStatus} from '@/lib/pulse';
import {pulseAssessmentsKey} from '@/lib/pulse-assessments';
import {installStorageForTests,resetStorageForTests} from '@/lib/storage';
import {FakeStorage} from '@/lib/testing/fake-storage';
import {summarizeAssessments, type PulseAssessment} from '@shared/pulse-assessment';
const NOW=1_800_000_000_000;
function row(from=NOW-600000, value=2): PulseAssessment {return {domain:'coding',inputHash:'test',from,to:from+300000,coverage:[{from,to:from+300000}],
 intensity:{value,confidence:1,probabilities:{0:0,1:0,2:1,3:0,4:0}},continuity:{value:2,confidence:1,probabilities:{0:0,1:0,2:1,3:0}},
 mode:null,model:'jev-1.13.0',scoredAt:NOW};}
test('Pulse graph and summary use the same assessments, omit raw private details and stale rows',async()=>{
 const storage=new FakeStorage();installStorageForTests(storage);
 try{await storage.append(pulseAssessmentsKey(),JSON.stringify({...row(),privateDetail:'secret-app-name'}),JSON.stringify(row(NOW-90000000)), '{bad');
 const payload=await getPulseStatus(NOW);
 assert.equal(payload.domains.coding.assessments.length,1);assert.equal(payload.domains.coding.score?.value,1.5);
 assert.equal(payload.domains.coding.score?.trend,'unknown');assert.equal(payload.domains.gaming.score,null);
 assert.equal(JSON.stringify(payload).includes('secret-app-name'),false);assert.equal('codingAssessments' in payload,false);
 }finally{resetStorageForTests();}
});
test('summary weights actual covered time and compares observed recent periods without zero filling',()=>{
 const a=row(NOW-4*3600000,0), b=row(NOW-600000,4);b.coverage=[{from:b.from,to:b.from+100000}];
 const score=summarizeAssessments([a,b],NOW-86400000,NOW)!;
 assert.equal(score.value,0.75);assert.equal(score.trend,'rising');
 assert.equal(summarizeAssessments([a],NOW-100000,NOW),null);
});
