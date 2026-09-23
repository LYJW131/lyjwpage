import assert from 'node:assert/strict';
import test from 'node:test';
import {getPulseStatus} from '@/lib/pulse';
import {assessmentRows,segmentRows,toAssessmentColumns,toSegmentColumns} from '@/lib/pulse-columns';
import type {PulseChartView} from '@/lib/types';
/** 线上是列，断言按行写更好读 */
const rowsOf=(view:PulseChartView)=>view.kind==='score'?{...view,assessments:assessmentRows(view.assessments)}:{...view,segments:segmentRows(view.segments)};
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
 assert.equal(payload.domains.coding.assessments.startSec.length,1);assert.equal(payload.domains.coding.score?.value,1.5);
 assert.equal(payload.domains.coding.score?.trend,'unknown');assert.deepEqual(payload.domains.gaming,{kind:"binary",segments:{startSec:[],endSec:[],value:[]},activeSeconds:0,score:null});
 assert.equal(JSON.stringify(payload).includes('secret-app-name'),false);assert.equal('codingAssessments' in payload,false);
 // 公开那份只留卡片要用的：没有概率、哈希、模型、评分时刻；覆盖和整窗一样时省略
 // 时刻是相对 window.from（NOW - 24h）的整秒
 assert.deepEqual(assessmentRows(payload.domains.coding.assessments)[0],{startSec:85800,endSec:86100,intensity:{value:2,confidence:1},continuity:{value:2},mode:null});
 }finally{resetStorageForTests();}
});
test('summary weights actual covered time and compares observed recent periods without zero filling',()=>{
 const a=row(NOW-4*3600000,0), b=row(NOW-600000,4);b.coverage=[{from:b.from,to:b.from+100000}];
 const score=summarizeAssessments([a,b],NOW-86400000,NOW)!;
 assert.equal(score.value,0.75);assert.equal(score.trend,'rising');
 assert.equal(summarizeAssessments([a],NOW-100000,NOW),null);
});

test('measured lanes map playing only and preserve silence', async () => {
 const {measuredPulseView}=await import('@/lib/pulse');
 const samples=[{t:0,level:3 as const},{t:60000,level:2 as const},{t:120000,level:1 as const}];
 for(const domain of ['listening','watching'] as const){
  const view=measuredPulseView(domain,samples,{from:0,to:1000000});
  assert.deepEqual(rowsOf(view),{kind:'binary',segments:[{startSec:0,endSec:60,value:1},{startSec:60,endSec:720,value:0}],activeSeconds:60});
 }
});
test('power preserves watts, excludes old level-only rows and expires current value',async()=>{
 const {measuredPulseView,planPulseSample,parsePulseSample}=await import('@/lib/pulse');
 const old={t:0,level:3 as const};const current={t:60000,level:2 as const,powerW:42.75};
 assert.deepEqual(rowsOf(measuredPulseView('charging',[old,current],{from:0,to:120000})),{kind:'power',segments:[{startSec:60,endSec:120,value:42.75}],currentPowerW:42.75});
 const stale=measuredPulseView('charging',[current],{from:0,to:700000});
 assert.equal(stale.kind,'power');if(stale.kind==='power')assert.equal(stale.currentPowerW,null);
 assert.equal(planPulseSample(current,{...current,t:70000,powerW:43}),null);
 // 插着线的小幅抖动不记，交给 5 分钟再确认；变得明显才记，瓦数留一位小数
 assert.equal(planPulseSample(current,{...current,t:90000,powerW:43}),null);
 assert.equal(planPulseSample(current,{...current,t:90000,powerW:48.26})?.powerW,48.3);
 assert.equal(planPulseSample(current,{...current,t:60000+300000,powerW:43})?.powerW,43);
 assert.equal(planPulseSample(current,{...current,t:70000,powerW:0})?.powerW,0);
 assert.equal(parsePulseSample(JSON.stringify({...current,powerW:-1})),null);
});


test('measured chart retains an independent Jev score and trend', async()=>{
 const {pulseKey}=await import('@/lib/pulse');
 const storage=new FakeStorage();installStorageForTests(storage);
 try {
  await storage.append(pulseAssessmentsKey(),JSON.stringify({...row(),domain:'watching'}));
  await storage.append(pulseKey('watching'),JSON.stringify({t:NOW-60000,level:3}));
  const view=(await getPulseStatus(NOW)).domains.watching;
  assert.equal(view.kind,'binary');assert.equal(view.score?.value,1.5);assert.equal(view.score?.trend,'unknown');
  if(view.kind==='binary')assert.deepEqual(segmentRows(view.segments),[{startSec:86340,endSec:86400,value:1}]);
 }finally{resetStorageForTests();}
});

test('listening draws the Jev score, not the Mac-only measurement, and keeps the track name',async()=>{
 const {pulseKey}=await import('@/lib/pulse');
 const storage=new FakeStorage();installStorageForTests(storage);
 try {
  const scored={...row(),domain:'listening'};
  await storage.append(pulseAssessmentsKey(),JSON.stringify(scored));
  await storage.append(pulseKey('listening'),JSON.stringify({t:scored.from,level:3,hint:'Hamilton – Helpless'}));
  const view=(await getPulseStatus(NOW)).domains.listening;
  // 实测只看得见 Mac / HomePod，所以这条线画的是评分；别的设备的证据只在评分里。
  assert.equal(view.kind,'score');
  if(view.kind==='score'){
   assert.equal(view.assessments.startSec.length,1);
   assert.equal(assessmentRows(view.assessments)[0].title,'Hamilton – Helpless');
  }
 }finally{resetStorageForTests();}
});

test('listening keeps stopped windows nameless instead of inheriting the last track',async()=>{
 const {pulseKey}=await import('@/lib/pulse');
 const storage=new FakeStorage();installStorageForTests(storage);
 try {
  const scored={...row(),domain:'listening'};
  await storage.append(pulseAssessmentsKey(),JSON.stringify(scored));
  await storage.append(pulseKey('listening'),JSON.stringify({t:scored.from,level:0,hint:'Old title'}));
  const view=(await getPulseStatus(NOW)).domains.listening;
  if(view.kind==='score')assert.equal(assessmentRows(view.assessments)[0].title,undefined);
 }finally{resetStorageForTests();}
});


test('gaming supports its 30-minute reporting cadence but leaves genuine missing reports empty',async()=>{
 const {measuredPulseView}=await import('@/lib/pulse');
 const m=60000;
 assert.deepEqual(rowsOf(measuredPulseView('gaming',[{t:0,level:0},{t:30*m,level:0},{t:60*m,level:3}],{from:0,to:120*m})),{
  kind:'binary',segments:[{startSec:0,endSec:60*60,value:0},{startSec:60*60,endSec:95*60,value:1}],activeSeconds:35*60
 });
});
test('Emby explicit stop persists until playback resumes; paused and active telemetry still expire',async()=>{
 const {measuredPulseView}=await import('@/lib/pulse');const m=60000;
 assert.deepEqual(rowsOf(measuredPulseView('watching',[{t:0,level:0},{t:180*m,level:3},{t:185*m,level:2},{t:190*m,level:3}],{from:0,to:210*m})),{
  kind:'binary',segments:[{startSec:0,endSec:180*60,value:0},{startSec:180*60,endSec:185*60,value:1},{startSec:185*60,endSec:190*60,value:0},{startSec:190*60,endSec:200*60,value:1}],activeSeconds:15*60
 });
});


test('media titles keep track boundaries without changing intensity or counting stops as playback',async()=>{
 const {measuredPulseView}=await import('@/lib/pulse');
 for(const domain of ['listening','watching','gaming'] as const){
  const view=measuredPulseView(domain,[{t:0,level:3,hint:'First title'},{t:60000,level:3,hint:'Second title'},{t:120000,level:2,hint:'Second title'},{t:180000,level:0,hint:'Old title'}],{from:0,to:240000});
  assert.deepEqual(rowsOf(view),{kind:'binary',activeSeconds:120,segments:[{startSec:0,endSec:60,value:1,title:'First title'},{startSec:60,endSec:120,value:1,title:'Second title'},{startSec:120,endSec:180,value:0,title:'Second title'},{startSec:180,endSec:240,value:0}]});
 }
 const power=measuredPulseView('charging',[{t:0,level:2,powerW:40,hint:'Private device'}],{from:0,to:60000});
 assert.equal(JSON.stringify(power).includes('Private device'),false);
});

test('listening mode round-trips through the parser; a bad mode drops only the mode, never the row',async()=>{
 const {parsePulseAssessment}=await import('@shared/pulse-assessment');
 const mode={value:'selecting',confidence:0.9,probabilities:{idle:0,paused:0,steady:0.1,selecting:0.9,traces:0}};
 const good=parsePulseAssessment(JSON.stringify({...row(),domain:'listening',mode}));
 assert.deepEqual(good?.mode,mode);
 const bad=parsePulseAssessment(JSON.stringify({...row(),domain:'listening',mode:{...mode,value:'mixed'}}));
 assert.ok(bad,'强度还在，曲线不能因为 mode 坏了消失');assert.equal(bad?.mode,null);
 const foreign=parsePulseAssessment(JSON.stringify({...row(),domain:'watching',mode}));
 assert.equal(foreign?.mode,null,'没有模式集合的域一律 null');
});

test('columns round-trip rows, keep only the titles and partial coverage that exist',()=>{
 const rows=[{startSec:0,endSec:300,intensity:{value:2,confidence:0.8},continuity:{value:1},mode:{value:'agent'}},
  {startSec:300,endSec:600,coverage:[{startSec:320,endSec:600}],intensity:{value:0,confidence:1},continuity:{value:0},mode:null,title:'Song'}];
 const columns=toAssessmentColumns(rows);
 assert.deepEqual(columns,{startSec:[0,300],endSec:[300,600],intensity:[2,0],confidence:[0.8,1],continuity:[1,0],mode:['agent',null],title:[null,'Song'],coverage:{'1':[{startSec:320,endSec:600}]}});
 assert.deepEqual(assessmentRows(columns),rows);
 assert.deepEqual(toAssessmentColumns([rows[0]]),{startSec:[0],endSec:[300],intensity:[2],confidence:[0.8],continuity:[1],mode:['agent']});
 const segments=[{startSec:0,endSec:60,value:42.5},{startSec:60,endSec:90,value:0}];
 assert.deepEqual(toSegmentColumns(segments),{startSec:[0,60],endSec:[60,90],value:[42.5,0]});
 assert.deepEqual(segmentRows(toSegmentColumns(segments)),segments);
});
