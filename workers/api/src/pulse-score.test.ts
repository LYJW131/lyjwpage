import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { mergeBucketReport } from "@shared/coding-buckets";
import { codingBucketsKey } from "@shared/coding-store";
import type { CodingTokenBucketReport } from "@shared/coding-usage";
import { CODING_OBSERVATION_HOLD_MS, CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, parseCodingAssessment } from "@shared/pulse-coding";
import { latestPulseAssessments, type PulseAssessment } from "@shared/pulse-assessment";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { PulseScorer } from "./pulse-score.ts";
import { PulseScoreState } from "./pulse-score-state.ts";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { resetStorageForTests } from '@/lib/storage';
import { installStorageForTests } from '../../../src/lib/storage-driver';
import { withRequestState } from '@shared/request-state';
import { requestStore, type Env } from './runtime';
import { commitPreparedAgentsReport } from './stores/agents';
import { prepareAgentLimits } from '@shared/ingest/agents';
const T = 1_800_000_000_000;
type LegacyShape = { from: number; to: number; collectedAt: number; sources: { id: string; state: string }[]; windows: { from: number; to?: number; agents: unknown[] }[] };
/** 一份按范围报的桶（Mac 本机扫描那种），存成 `pulse:token-buckets:<来源>` 的样子 */
function storedBuckets(report: LegacyShape): string {
  const shaped = { from: report.from, to: report.to, collectedAt: report.collectedAt, agents: report.sources,
    windows: report.windows.map((window) => ({ from: window.from, agents: window.agents })) } as unknown as CodingTokenBucketReport;
  return JSON.stringify(mergeBucketReport(null, shaped, report.collectedAt));
}
function setup() {
  let now = T + PULSE_SCORE_WINDOW_MS + 120_000;
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: (string | number | null)[]) {
      if (!args.length && query.includes(";")) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = db.prepare(query);
      if (statement.columns().length) return { toArray: () => statement.all(...args) as Record<string, unknown>[], rowsWritten: 0 };
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  } as unknown as SqlDatabase;
  const transaction = <TResult>(work: () => TResult): TResult => {
    db.exec("BEGIN");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const store = new SqliteStore(sql, transaction, () => now);
  db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let unreachable = false;
  const execute = (commands: StorageCommand[]): unknown[] => {
    if (unreachable) throw new Error("fake storage unreachable");
    return store.execute(commands);
  };
  const storage = Object.assign(new StorageClient(async (commands) => execute(commands)), {
    async append(key: string, ...values: string[]): Promise<number> {
      return execute([{ op: "append", key, values }])[0] as number;
    },
    setUnreachable(value = true): void { unreachable = value; },
  });
  const requests: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  let fail = false;
  let nextToken = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (fail) return new Response(null, { status: 503 });
    return Response.json({ model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const q = question as { type: string; criteria: string[] | Record<string, string> };
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria); const pick = keys.includes("mixed") ? "mixed" : keys[keys.length - 1];
        return [id, { type: "choice", choice: pick, confidence: 1, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 1 : 0])) }];
      }
      const levels = q.criteria as string[];
      return [id, { type: "score", score: levels.length - 1, confidence: 1,
        probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === levels.length - 1 ? 1 : 0])) }];
    })) });
  };
  const coordinator = () => new PulseScoreState({ sql, execute, now: () => now, token: () => `claim-${++nextToken}` });
  const make = () => new PulseScorer({ coordinator: coordinator(), apiKey: "test", fetch: fetcher, log: (e) => errors.push(e) });
  const push = (at: number, available = true) => storage.append(codingObservationsKey(), JSON.stringify({ t: at, available,
    desktop: { application: "Zed", coding: true }, agents: [{ id: "codex", model: "model", active: true }] }));
  return { storage, make, coordinator, push, requests, errors, now: () => now,
    advance: (ms: number) => { now += ms; }, fail: (value: boolean) => { fail = value; } };
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
  const scorer = new PulseScorer({ coordinator: b.coordinator(), apiKey: "test",
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

function assessment(domain: "coding", from: number, scoredAt: number, inputHash = "hash"): PulseAssessment {
  return {
    domain,
    from,
    to: from + PULSE_SCORE_WINDOW_MS,
    coverage: [{ from, to: from + PULSE_SCORE_WINDOW_MS }],
    intensity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 } },
    continuity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } },
    mode: null,
    model: "jev-test",
    scoredAt,
    inputHash,
  };
}

test("pulse score state: concurrent instances claim once and a restart preserves eligibility", async () => {
  const b = setup();
  const firstState = b.coordinator();
  const restartedState = b.coordinator();
  const [first, second] = await Promise.all([
    firstState.claimPulseScore(),
    restartedState.claimPulseScore(),
  ]);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(await restartedState.claimPulseScore(), null, "a new class instance sees the durable lease");

  b.advance(180_001);
  const replacement = await restartedState.claimPulseScore();
  assert.ok(replacement);
  assert.ok(replacement.generation > first.generation);
  assert.equal(await firstState.finishPulseScore(first.token, first.generation, []), false);
  assert.equal(await b.coordinator().claimPulseScore(), null, "the stale release did not clear the replacement");
  assert.equal(await restartedState.finishPulseScore(replacement.token, replacement.generation, []), true);
});

test("pulse score state: expired results cannot overwrite a replacement window", async () => {
  const b = setup();
  const firstState = b.coordinator();
  const first = await firstState.claimPulseScore();
  assert.ok(first);
  assert.equal(await firstState.activatePulseScore(first.token, first.generation), true);

  b.advance(CODING_WINDOW_MS + 1);
  const replacementState = b.coordinator();
  const replacement = await replacementState.claimPulseScore();
  assert.ok(replacement);
  assert.equal(await replacementState.activatePulseScore(replacement.token, replacement.generation), true);
  const from = T;
  const current = assessment("coding", from, b.now(), "replacement");
  assert.equal(await replacementState.finishPulseScore(replacement.token, replacement.generation, [current]), true);

  const stale = assessment("coding", from, first.now, "stale");
  assert.equal(await firstState.finishPulseScore(first.token, first.generation, [stale]), false);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].inputHash, "replacement");
});

test("pulse score state: commit merges at submit time and compacts a list past its cap to the newest rows", async () => {
  const b = setup();
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  const records = Array.from({ length: 10_001 }, (_, index) => assessment("coding", T - index * PULSE_SCORE_WINDOW_MS, b.now(), `hash-${index}`));
  const concurrent = assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "concurrent");
  await b.storage.append(pulseAssessmentsKey(), JSON.stringify(concurrent));
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, records), true);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.equal(saved.length, 2016);
  assert.ok(saved.some((record) => record.inputHash === "concurrent"));
});

async function finishWith(b: ReturnType<typeof setup>, records: PulseAssessment[]) {
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, records), true);
}

test("pulse score state: a round only appends its new results, never rewrites the list", async () => {
  const b = setup();
  const seeded = Array.from({ length: 20 }, (_, i) => JSON.stringify(assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `seed-${i}`)));
  await b.storage.append(pulseAssessmentsKey(), ...seeded);
  await finishWith(b, [assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "new")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 21);
  assert.deepEqual(rows.slice(0, 20), seeded, "existing rows are left in place");
});

test("pulse score state: a re-scored window is appended and the later row wins for every reader", async () => {
  const b = setup();
  const seeded = Array.from({ length: 20 }, (_, i) => JSON.stringify(assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `seed-${i}`)));
  await b.storage.append(pulseAssessmentsKey(), ...seeded);
  await finishWith(b, [assessment("coding", T, b.now(), "rescored")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 21);
  const latest = latestPulseAssessments(rows);
  assert.equal(latest.length, 20);
  assert.equal(latest.find((row) => row.from === T)?.inputHash, "rescored");
});

test("pulse score state: once superseded rows outweigh half the live ones the list is compacted", async () => {
  const b = setup();
  const live = Array.from({ length: 10 }, (_, i) => assessment("coding", T - i * PULSE_SCORE_WINDOW_MS, b.now(), `live-${i}`));
  // 同一批窗口的六份旧评分：被覆盖的行远多于有效行
  const stale = Array.from({ length: 6 }, (_, n) => live.map((row) => JSON.stringify({ ...row, inputHash: `old-${n}` }))).flat();
  await b.storage.append(pulseAssessmentsKey(), ...stale, ...live.map((row) => JSON.stringify(row)));
  await finishWith(b, [assessment("coding", T + PULSE_SCORE_WINDOW_MS, b.now(), "new")]);
  const rows = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.equal(rows.length, 11);
  const parsed = rows.map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.ok(parsed.every((row) => !row.inputHash.startsWith("old-")));
  assert.deepEqual(parsed.map((row) => row.from), [...parsed.map((row) => row.from)].sort((a, b) => a - b));
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

async function quietCoding(b: ReturnType<typeof setup>, from: number) {
  for (let index = 0; index < PULSE_SCORE_WINDOW_MS / CODING_OBSERVATION_HOLD_MS; index += 1) {
    await b.storage.append(codingObservationsKey(), JSON.stringify({
      t: from + index * CODING_OBSERVATION_HOLD_MS, available: true,
      desktop: { application: "Safari", coding: false }, agents: [],
    }));
  }
}

test("fully observed zero windows skip Jev and store the lowest certain score", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({
    from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS + 60_000,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [],
  }));
  await b.make().run();
  assert.equal(b.requests.length, 0);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.deepEqual(rows.map((row) => row.domain), ["coding"]);
  for (const row of rows) {
    assert.equal(row.model, "rules");
    assert.equal(row.to - row.from, PULSE_SCORE_WINDOW_MS);
    assert.deepEqual(row.coverage, [{ from: row.from, to: row.to }]);
    assert.equal(row.intensity.value, 0);
    assert.equal(row.intensity.confidence, 1);
    assert.equal(row.intensity.probabilities["0"], 1);
    assert.equal(Object.values(row.intensity.probabilities).reduce((sum, p) => sum + p, 0), 1);
    assert.equal(row.continuity.value, 0);
    assert.equal(row.continuity.confidence, 1);
    assert.equal(row.continuity.probabilities["0"], 1);
    assert.equal(row.mode?.value, "idle");
    assert.equal(row.mode?.confidence, 1);
    assert.equal(row.mode?.probabilities.idle, 1);
  }
  await b.make().run();
  assert.equal(b.requests.length, 0);
  assert.equal((await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).length, 1);
});

test("missing token evidence still calls Jev for an idle-looking window", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.ok(rows.every((row) => row.model === "jev-1.13.0"));
  assert.equal((b.requests[0].state as { windows: { tokenUsage: unknown }[] }).windows[0].tokenUsage, null);
});

test("a zero window is skipped while another coding window still calls Jev", async () => {
  const b = setup();
  await quietCoding(b, T);
  const next = T + PULSE_SCORE_WINDOW_MS;
  for (let index = 0; index < 5; index += 1) await b.push(next + index * CODING_OBSERVATION_HOLD_MS);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({
    from: T, to: next + PULSE_SCORE_WINDOW_MS, collectedAt: next + PULSE_SCORE_WINDOW_MS + 60_000,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [],
  }));
  b.advance(PULSE_SCORE_WINDOW_MS);
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(rows.find((row) => row.from === T)?.model, "rules");
  assert.equal(rows.find((row) => row.from === T)?.mode?.value, "idle");
  assert.equal(rows.find((row) => row.from === next)?.model, "jev-1.13.0");
  assert.ok((rows.find((row) => row.from === next)?.intensity.value ?? 0) > 0);
});

test("Mac-offline account evidence reaches scoring and the public chart, then disappears after source expiry", async () => {
  const b = setup();
  // Drive the actual producer commits into the same SQLite store used by the scorer.
  installStorageForTests(b.storage);
  const pending: Promise<unknown>[] = [];
  try {
    await requestStore.run({ env: { LIVE_PUSH: { idFromName: () => null, get: () => ({ broadcast: async () => {} }) } } as unknown as Env,
      ctx: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } }, () => withRequestState(async () => {
      await commitPreparedAgentsReport(prepareAgentLimits({ codingUsage: { agents: [{ id: 'cursor', state: 'ok', collectedAt: T, error: null,
        warning: null, sessionCount: null, days: [] }] } }, T));
    }));
  } finally { await Promise.allSettled(pending); resetStorageForTests(); }
  await b.make().run();
  assert.equal(b.requests.length, 0, "checked but inactive sources use a limited-confidence zero baseline");
  const { codingLaneView } = await import('@/lib/pulse');
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.deepEqual(rows.map((row) => row.domain), ['coding']);
  for (const row of rows) {
    assert.deepEqual(row.coverage, [{ from: T, to: T + PULSE_SCORE_WINDOW_MS }]);
    assert.equal(row.model, 'rules:limited-source');
    assert.equal(row.intensity.value, 0);
    assert.equal(row.intensity.confidence, 0.5);
    assert.equal(row.continuity.value, 0);
    assert.equal(row.mode?.value, 'idle');
    const exposed = codingLaneView([], [], [row], { from: T, to: T + PULSE_SCORE_WINDOW_MS });
    assert.deepEqual(exposed.assessments, { startSec: [0], endSec: [900], intensity: [0], confidence: [0.5], mode: ['idle'] });
    assert.equal(JSON.stringify(exposed).includes('cursor'), false, "private source facts stay internal");
  }
  b.advance(2 * 3_600_000);
  await b.make().run();
  const later = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(later.some((r) => r.from >= T + 75 * 60_000), false, "expired sources never fill later windows");
});


test("independent source baseline never hides Cursor or token activity", async () => {
  const cursor = setup();
  await cursor.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: T }));
  await cursor.make().run();
  assert.equal(cursor.requests.length, 1);
  assert.equal((cursor.requests[0].state as { windows: { cursorActiveSeconds: number }[] }).windows[0].cursorActiveSeconds, 300);
  const token = setup();
  await token.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: null }));
  await token.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + 300_000, collectedAt: T + 300_000,
    sources: [{ id: 'codex', state: 'ok' }, { id: 'claude', state: 'unavailable' }], windows: [{ from: T, to: T + 300_000, agents: [{ id: 'codex', model: null,
      inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: 1 }] }] }));
  await token.make().run();
  assert.equal(token.requests.length, 1);
});


test("Cursor coverage does not turn a missing Mac agent module into a certain zero", async () => {
  const b = setup();
  for (let t = T; t < T + PULSE_SCORE_WINDOW_MS; t += 120_000) {
    await b.storage.append(codingObservationsKey(), JSON.stringify({ t, available: true, desktop: { application: 'Finder', coding: false }, agents: null }));
  }
  await b.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: null }));
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: 'codex', state: 'ok' }, { id: 'claude', state: 'ok' }], windows: [] }));
  await b.make().run();
  assert.equal(b.requests.length, 1);
});


test("token evidence from the Cursor account and Claude Code cloud counts only as positive evidence; certain zero needs the Mac range", async () => {
  const row = (id: string, inputTokens: number, eventCount: number | null) => ({ id, model: null, inputTokens, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount });
  const extra = (source: "agents" | "agents-otlp", id: string, eventCount: number | null) => JSON.stringify({
    coverage: [], agents: [{ id, state: "partial" }], windows: [{ from: T + 300_000, agents: [row(id, 7, eventCount)] }],
    collectedAt: T + 900_000, receivedAt: T + 900_000,
  });
  // Mac 把整窗都报成 0，但云端那一路在第二个桶里有 token：不是确定的 0，照问 Jev
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [] }));
  await b.storage.set(codingBucketsKey("agents-otlp"), extra("agents-otlp", "claude", null));
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const token = (b.requests[0].state as { windows: { tokenUsage: { observedBucketCount: number; sources: { source: string; id: string; state: string }[]; agents: { source: string; id: string; inputTokens: number; eventCount: number | null }[] } }[] }).windows[0].tokenUsage;
  assert.equal(token.observedBucketCount, 3);
  assert.deepEqual(token.sources.map((source) => [source.source, source.id, source.state]), [["mac", "codex", "ok"], ["mac", "claude", "ok"], ["agents-otlp", "claude", "partial"]]);
  assert.deepEqual(token.agents.map((agent) => [agent.source, agent.id, agent.inputTokens, agent.eventCount]), [["agents-otlp", "claude", 7, null]]);

  // 没有 Mac 的覆盖，只有 Cursor 账号的桶：证据照样送过去，未知的桶还是未知
  const cursor = setup();
  await cursor.push(T);
  await cursor.storage.set(codingBucketsKey("agents"), extra("agents", "cursor", 3));
  await cursor.make().run();
  const cursorToken = (cursor.requests[0].state as { windows: { tokenUsage: { observedBucketCount: number; unknownBucketCount: number; agents: { source: string; eventCount: number | null }[] } }[] }).windows[0].tokenUsage;
  assert.deepEqual([cursorToken.observedBucketCount, cursorToken.unknownBucketCount], [0, 3]);
  assert.deepEqual(cursorToken.agents.map((agent) => [agent.source, agent.eventCount]), [["agents", 3]]);
});

test("a Cursor request billed without tokens (0 tokens, one event) is still activity evidence, not a certain zero", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [] }));
  await b.storage.set(codingBucketsKey("agents"), JSON.stringify({
    coverage: [{ from: T - 600_000, to: T + PULSE_SCORE_WINDOW_MS }], agents: [{ id: "cursor", state: "partial" }],
    windows: [{ from: T + 600_000, agents: [{ id: "cursor", model: "composer-2", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: 1 }] }],
    collectedAt: T + PULSE_SCORE_WINDOW_MS, receivedAt: T + PULSE_SCORE_WINDOW_MS,
  }));
  await b.make().run();
  assert.equal(b.requests.length, 1, "Jev judges the window");
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(rows[0]?.model, "jev-1.13.0");
});
