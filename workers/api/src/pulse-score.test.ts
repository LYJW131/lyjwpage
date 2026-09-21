import assert from "node:assert/strict";
import test from "node:test";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { codingObservationsKey, codingTokenUsageKey } from "@/lib/coding-pulse";
import { CODING_WINDOW_MS, parseCodingAssessment } from "@shared/pulse-coding";
import { PulseScorer } from "./pulse-score.ts";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
const T = 1_800_000_000_000;
function setup() {
  const storage = new FakeStorage();
  let now = T + CODING_WINDOW_MS + 120_000;
  const requests: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  let fail = false;
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (fail) return new Response(null, { status: 503 });
    return Response.json({ model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const q = question as { type: string; criteria: string[] | Record<string, string> };
      if (q.type === "choice") return [id, { type: "choice", choice: "mixed", confidence: 1,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map((k) => [k, k === "mixed" ? 1 : 0])) }];
      const levels = q.criteria as string[];
      return [id, { type: "score", score: levels.length - 1, confidence: 1,
        probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === levels.length - 1 ? 1 : 0])) }];
    })) });
  };
  const make = () => new PulseScorer({ storage, apiKey: "test", now: () => now, fetch: fetcher, log: (e) => errors.push(e) });
  const push = (at: number, available = true) => storage.append(codingObservationsKey(), JSON.stringify({ t: at, available,
    desktop: { application: "Zed", coding: true }, agents: [{ id: "codex", model: "model", active: true }] }));
  return { storage, make, push, requests, errors, advance: (ms: number) => { now += ms; }, fail: (value: boolean) => { fail = value; } };
}
test("coding scorer batches dimensions, freezes successful windows, skips unknown time", async () => {
  const b = setup(); const scorer = b.make();
  await scorer.run(); assert.equal(b.requests.length, 0);
  await b.push(T); await b.push(T + 120_000); await b.push(T + 240_000);
  await scorer.run();
  assert.equal(b.requests.length, 1);
  assert.equal(Object.keys(b.requests[0].questions as object).length, 3);
  const first = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(first.length, 1);
  assert.equal(parseCodingAssessment(first[0])?.intensity.value, 4);
  await b.make().run(); assert.equal(b.requests.length, 1, "restart keeps throttle");
  await b.push(T + CODING_WINDOW_MS, false);
  b.advance(CODING_WINDOW_MS); await scorer.run();
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
  assert.equal(rows.length, 13);
  assert.equal(b.requests.length, 13);
  assert.ok(b.requests.every((request) => (request.state as { windows: unknown[] }).windows.length === 1));
  assert.ok(rows.every((row) => row!.to <= T + CODING_WINDOW_MS));
});

test("coding isolates windows, bounds concurrency and saves successes when another window fails", async () => {
  const storage = new FakeStorage();
  for (let i = 0; i < 20; i++) await storage.append(codingObservationsKey(), JSON.stringify({
    t: T + i * 60_000, available: true, desktop: { application: "Zed", coding: true }, agents: [],
  }));
  let active = 0, peak = 0, calls = 0;
  const errors: unknown[] = [];
  const scorer = new PulseScorer({ storage, apiKey: "test", now: () => T + 4 * CODING_WINDOW_MS + 120_000,
    log: (error) => errors.push(error), fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.state.windows.length, 1);
      assert.equal(Object.keys(request.questions).length, 3);
      active++; peak = Math.max(peak, active); calls++;
      await new Promise((resolve) => setTimeout(resolve, 1)); active--;
      if (request.state.windows[0].from === T) return new Response(null, { status: 503 });
      return Response.json({ model: "jev-1.13.0", answers: {
        w0Intensity: { type: "score", score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
        w0Continuity: { type: "score", score: 3, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1 } },
        w0Mode: { type: "choice", choice: "interactive", confidence: 1, probabilities: { idle: 0, brief: 0, interactive: 1, agent: 0, mixed: 0 } },
      } });
    } });
  await scorer.run();
  assert.equal(calls, 4); assert.equal(peak, 3); assert.equal(errors.length, 1);
  const rows = (await storage.listRange(pulseAssessmentsKey(), 0, -1)).map(parseCodingAssessment);
  assert.equal(rows.length, 3); assert.ok(rows.every((row) => row!.from > T));
});

test('late token evidence re-scores only changed windows; identical evidence stays frozen', async () => {
  const b=setup(); await b.push(T); await b.make().run();
  const report={from:T-300000,to:T+300000,collectedAt:T+420000,sources:[{id:'codex',state:'ok'},{id:'claude',state:'unavailable'}],windows:[{from:T,to:T+300000,agents:[{id:'codex',model:'test',inputTokens:100,outputTokens:50,cacheReadTokens:20,cacheCreationTokens:0,reasoningTokens:10,eventCount:1}]}]};
  await b.storage.set(codingTokenUsageKey(),JSON.stringify(report));b.advance(CODING_WINDOW_MS);await b.make().run();
  assert.equal(b.requests.length,2);
  const state=b.requests[1].state as {windows:{tokenUsage:typeof report}[]};
  assert.ok(JSON.stringify(state).includes('outputTokens'));
  b.advance(CODING_WINDOW_MS);await b.make().run();assert.equal(b.requests.length,2);
  const rows=await b.storage.listRange(pulseAssessmentsKey(),0,-1);assert.equal(rows.length,1);
});

test('all domains retain Jev summaries independently of measured charts',async()=>{
 const b=setup();await b.push(T);
 const {pulseKey}=await import('@/lib/pulse');
 for(const domain of ['listening','watching','gaming','charging','activity'] as const)
   await b.storage.append(pulseKey(domain),JSON.stringify({t:T,until:T+CODING_WINDOW_MS,level:3,...(domain === "charging" ? {powerW:72.5} : {})}));
 await b.make().run();assert.equal(b.requests.length,6);
 assert.ok(b.requests.some((request)=>JSON.stringify(request.state).includes('"value":72.5')));
 const rows=await b.storage.listRange(pulseAssessmentsKey(),0,-1);
 assert.equal(new Set(rows.map((r)=>JSON.parse(r).domain)).size,6);
 b.advance(CODING_WINDOW_MS);await b.make().run();assert.equal(b.requests.length,6);
});
