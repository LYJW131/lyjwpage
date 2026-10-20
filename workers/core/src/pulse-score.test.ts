import assert from "node:assert/strict";
import test from "node:test";
import { codingObservationsKey } from "./coding-pulse";
import { codingBucketsKey } from "@shared/coding-store";
import { CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, parseCodingAssessment } from "@shared/pulse-coding";
import { latestPulseAssessments } from "@shared/pulse-assessment";
import { PulseScorer } from "./pulse-score.ts";
import { pulseAssessmentsKey } from "./pulse-assessments";
import { T, setup, storedBuckets } from "./testing/pulse-score-harness";

test("coding scorer batches dimensions, freezes successful windows, skips unknown time", async () => {
  const b = setup(); const scorer = b.make();
  await scorer.run(); assert.equal(b.requests.length, 0);
  await b.push(T); await b.push(T + 120_000); await b.push(T + 240_000);
  await scorer.run(); assert.equal(b.requests.length, 0, "an idle claim holds its lease until it lapses");
  b.advance(CODING_WINDOW_MS); await scorer.run();
  assert.equal(b.requests.length, 1);
  assert.equal(Object.keys(b.requests[0].questions as object).length, 3);
  const first = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(first.length, 1);
  assert.equal(parseCodingAssessment(first[0])?.intensity.value, 4);
  await b.make().run(); assert.equal(b.requests.length, 1, "restart keeps throttle");
  await b.push(T + PULSE_SCORE_WINDOW_MS, false);
  b.advance(PULSE_SCORE_WINDOW_MS); await scorer.run();
  assert.equal(b.requests.length, 1, "offline interval produces no call");
  assert.deepEqual(await b.storage.listRange(pulseAssessmentsKey(), 0, -1), first);
});
test("coding failures retry after five minutes and never turn failed reads into empty history", async () => {
  const b = setup(); await b.push(T);
  b.fail(true); await b.make().run();
  assert.equal(b.errors.length, 1);
  assert.deepEqual(await b.storage.listRange(pulseAssessmentsKey(), 0, -1), []);
  b.fail(false); await b.make().run(); assert.equal(b.requests.length, 1);
  b.advance(CODING_WINDOW_MS); await b.make().run();
  assert.equal(b.requests.length, 2);
  const before = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  b.storage.setUnreachable(); b.advance(CODING_WINDOW_MS); await b.make().run();
  assert.equal(b.requests.length, 2);
  b.storage.setUnreachable(false);
  assert.deepEqual(await b.storage.listRange(pulseAssessmentsKey(), 0, -1), before);
});
test("coding catches up bounded batches and excludes the unfinished window", async () => {
  const b = setup();
  for (let i = 0; i < 90; i++) await b.push(T - 60 * 60_000 + i * 60_000);
  await b.make().run();
  const rows = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map(parseCodingAssessment);
  assert.equal(rows.length, 5);
  assert.equal(b.requests.length, 5);
  assert.ok(b.requests.every((request) => (request.state as { windows: unknown[] }).windows.length === 1));
  assert.ok(rows.every((row) => row!.to <= T + PULSE_SCORE_WINDOW_MS));
});

test("coding isolates windows, bounds concurrency and saves successes when another window fails", async () => {
  const b = setup();
  for (let i = 0; i < 20; i++) await b.storage.append(codingObservationsKey(), JSON.stringify({
    t: T + i * 60_000, available: true, desktop: { application: "Zed", coding: true }, agents: [],
  }));
  let active = 0, peak = 0, calls = 0;
  const errors: unknown[] = [];
  b.advance(3 * CODING_WINDOW_MS);
  const state = b.coordinator();
  const scorer = new PulseScorer({ coordinator: state,
    log: (error) => errors.push(error), decide: async (request) => {
      assert.equal((request.state as { windows: unknown[] }).windows.length, 1);
      assert.equal(Object.keys(request.questions).length, 3);
      active++; peak = Math.max(peak, active); calls++;
      await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      if ((request.state as { windows: { from: number }[] }).windows[0].from === T) throw new Error("AI 503");
      return { model: "clef", answers: {
        w0Intensity: { type: "score", score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
        w0Continuity: { type: "score", score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } },
        w0Mode: { type: "choice", choice: "interactive", confidence: 1, probabilities: { idle: 0, brief: 0, interactive: 1, agent: 0, mixed: 0 } },
      } };
    } });
  await scorer.run(await state.claimPulseScore());
  assert.equal(calls, 2); assert.equal(peak, 2); assert.equal(errors.length, 1);
  const rows = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map(parseCodingAssessment);
  assert.equal(rows.length, 1); assert.ok(rows.every((row) => row!.from > T));
});

test('late token evidence re-scores only changed windows; identical evidence stays frozen', async () => {
  const b=setup(); await b.push(T); await b.make().run();
  const report={from:T-300000,to:T+300000,collectedAt:T+420000,sources:[{id:'codex',state:'ok'},{id:'claude',state:'unavailable'}],windows:[{from:T,to:T+300000,agents:[{id:'codex',model:'test',inputTokens:100,outputTokens:50,cacheReadTokens:20,cacheCreationTokens:0,reasoningTokens:10,eventCount:1}]}]};
  await b.storage.set(codingBucketsKey("mac"),storedBuckets(report));b.advance(CODING_WINDOW_MS);await b.make().run();
  assert.equal(b.requests.length,2);
  const state=b.requests[1].state as {windows:{tokenUsage:typeof report}[]};
  assert.ok(JSON.stringify(state).includes('outputTokens'));
  b.advance(CODING_WINDOW_MS);await b.make().run();assert.equal(b.requests.length,2);
  const rows=await b.storage.listRange(pulseAssessmentsKey(),0,-1);assert.equal(rows.length,1);
});

test('coding score aggregates sparse factual token buckets and keeps zero-event buckets', async () => {
  const b = setup();
  await b.push(T); await b.push(T + 300_000); await b.push(T + 600_000);
  const agent = (outputTokens: number) => ({id:'codex',model:'model',inputTokens:10,outputTokens,cacheReadTokens:2,cacheCreationTokens:1,reasoningTokens:1,eventCount:1});
  const usage = {from:T,to:T+900_000,collectedAt:T+1_020_000,sources:[{id:'codex',state:'partial'},{id:'claude',state:'unavailable'}],windows:[
    {from:T,to:T+300_000,agents:[agent(20)]},
    {from:T+600_000,to:T+900_000,agents:[agent(30)]},
  ]};
  await b.storage.set(codingBucketsKey("mac"), storedBuckets(usage));
  await b.make().run();
  const token = ((b.requests[0].state as {windows:{tokenUsage:{agents:{outputTokens:number}[];observedBucketCount:number;unknownBucketCount:number}}[]}).windows[0].tokenUsage);
  assert.equal(token.agents[0].outputTokens, 50);
  assert.equal(token.observedBucketCount, 3);
  assert.equal(token.unknownBucketCount, 0);
  const row = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(),0,-1))[0];
  assert.equal(row.to-row.from,PULSE_SCORE_WINDOW_MS);
});


test('coding token usage keeps an empty reported interval as measured zero', async () => {
  const b = setup(); await b.push(T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({from:T,to:T+900_000,collectedAt:T+1_020_000,
    sources:[{id:'codex',state:'ok'},{id:'claude',state:'ok'}],windows:[]}));
  await b.make().run();
  const token = ((b.requests[0].state as {windows:{tokenUsage:{agents:unknown[];observedBucketCount:number;unknownBucketCount:number}}[]}).windows[0].tokenUsage);
  assert.deepEqual(token.agents,[]);
  assert.equal(token.observedBucketCount,3);
  assert.equal(token.unknownBucketCount,0);
});

test('coding token usage excludes partially reported boundary buckets', async () => {
  const b = setup(); await b.push(T);
  const agent = {id:'codex',model:'model',inputTokens:1,outputTokens:10,cacheReadTokens:0,cacheCreationTokens:0,reasoningTokens:0,eventCount:1};
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({from:T+150_000,to:T+750_000,collectedAt:T+1_020_000,
    sources:[{id:'codex',state:'partial'},{id:'claude',state:'unavailable'}],windows:[
      {from:T,to:T+300_000,agents:[agent]}, {from:T+300_000,to:T+600_000,agents:[agent]},
      {from:T+600_000,to:T+900_000,agents:[agent]}]}));
  await b.make().run();
  const token = ((b.requests[0].state as {windows:{tokenUsage:{agents:{outputTokens:number}[];observedBucketCount:number;unknownBucketCount:number;sources:{state:string}[]}}[]}).windows[0].tokenUsage);
  assert.equal(token.agents[0].outputTokens,10);
  assert.equal(token.observedBucketCount,1);
  assert.equal(token.unknownBucketCount,2);
  assert.deepEqual(token.sources.map((source)=>source.state),['partial','unavailable']);
});
