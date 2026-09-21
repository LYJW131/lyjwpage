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
 assert.equal(payload.domains.coding.kind,"score");
 if(payload.domains.coding.kind!=="score")throw Error("kind");
 assert.equal(payload.domains.coding.assessments.length,1);assert.equal(payload.domains.coding.score?.value,1.5);
 assert.equal(payload.domains.coding.score?.trend,'unknown');assert.deepEqual(payload.domains.gaming,{kind:"binary",segments:[],activeSeconds:0});
 assert.equal(JSON.stringify(payload).includes('secret-app-name'),false);assert.equal('codingAssessments' in payload,false);
 }finally{resetStorageForTests();}
});
test('summary weights actual covered time and compares observed recent periods without zero filling',()=>{
 const a=row(NOW-4*3600000,0), b=row(NOW-600000,4);b.coverage=[{from:b.from,to:b.from+100000}];
 const score=summarizeAssessments([a,b],NOW-86400000,NOW)!;
 assert.equal(score.value,0.75);assert.equal(score.trend,'rising');
 assert.equal(summarizeAssessments([a],NOW-100000,NOW),null);
});

test('measured lanes map playing only, preserve silence and do not expose hints', async () => {
 const {measuredPulseView}=await import('@/lib/pulse');
 const samples=[{t:0,level:3 as const,hint:'private'},{t:60000,level:2 as const},{t:120000,level:1 as const}];
 for(const domain of ['listening','watching','gaming'] as const){
  const view=measuredPulseView(domain,samples,{from:0,to:1000000});
  assert.deepEqual(view,{kind:'binary',segments:[{from:0,to:60000,value:1},{from:60000,to:720000,value:0}],activeSeconds:60});
 }
});
test('power preserves watts, excludes old level-only rows and expires current value',async()=>{
 const {measuredPulseView,planPulseSample,parsePulseSample}=await import('@/lib/pulse');
 const old={t:0,level:3 as const};const current={t:60000,level:2 as const,powerW:42.75};
 assert.deepEqual(measuredPulseView('charging',[old,current],{from:0,to:120000}),{kind:'power',segments:[{from:60000,to:120000,value:42.75}],currentPowerW:42.75});
 const stale=measuredPulseView('charging',[current],{from:0,to:700000});
 assert.equal(stale.kind,'power');if(stale.kind==='power')assert.equal(stale.currentPowerW,null);
 assert.equal(planPulseSample(current,{...current,t:70000,powerW:43}),null);
 assert.equal(planPulseSample(current,{...current,t:90000,powerW:43})?.powerW,43);
 assert.equal(planPulseSample(current,{...current,t:70000,powerW:0})?.powerW,0);
 assert.equal(parsePulseSample(JSON.stringify({...current,powerW:-1})),null);
});
