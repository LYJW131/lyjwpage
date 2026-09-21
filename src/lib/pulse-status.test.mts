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
 assert.equal(payload.domains.coding.score?.trend,'unknown');assert.deepEqual(payload.domains.gaming,{kind:"binary",segments:[],activeSeconds:0,score:null});
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
 for(const domain of ['listening','watching'] as const){
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


test('measured chart retains an independent Jev score and trend', async()=>{
 const {pulseKey}=await import('@/lib/pulse');
 const storage=new FakeStorage();installStorageForTests(storage);
 try {
  await storage.append(pulseAssessmentsKey(),JSON.stringify({...row(),domain:'listening'}));
  await storage.append(pulseKey('listening'),JSON.stringify({t:NOW-60000,level:3}));
  const view=(await getPulseStatus(NOW)).domains.listening;
  assert.equal(view.kind,'binary');assert.equal(view.score?.value,1.5);assert.equal(view.score?.trend,'unknown');
  if(view.kind==='binary')assert.deepEqual(view.segments,[{from:NOW-60000,to:NOW,value:1}]);
 }finally{resetStorageForTests();}
});


test('gaming supports its 30-minute reporting cadence but leaves genuine missing reports empty',async()=>{
 const {measuredPulseView}=await import('@/lib/pulse');
 const m=60000;
 assert.deepEqual(measuredPulseView('gaming',[{t:0,level:0},{t:30*m,level:0},{t:60*m,level:3}],{from:0,to:120*m}),{
  kind:'binary',segments:[{from:0,to:60*m,value:0},{from:60*m,to:95*m,value:1}],activeSeconds:35*60
 });
});
test('Emby explicit stop persists until playback resumes; paused and active telemetry still expire',async()=>{
 const {measuredPulseView}=await import('@/lib/pulse');const m=60000;
 assert.deepEqual(measuredPulseView('watching',[{t:0,level:0},{t:180*m,level:3},{t:185*m,level:2},{t:190*m,level:3}],{from:0,to:210*m}),{
  kind:'binary',segments:[{from:0,to:180*m,value:0},{from:180*m,to:185*m,value:1},{from:185*m,to:190*m,value:0},{from:190*m,to:200*m,value:1}],activeSeconds:15*60
 });
});
