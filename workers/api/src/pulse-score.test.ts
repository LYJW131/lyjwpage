import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { codingObservationsKey, codingTokenUsageKey } from "@/lib/coding-pulse";
import { listeningPlaysKey } from "@/lib/listening-pulse";
import { pulseIntervalRevisionKey, pulseKey } from "@/lib/pulse";
import { PULSE_DOMAINS, type PulseDomain } from "@/lib/types";
import { CODING_WINDOW_MS, parseCodingAssessment } from "@shared/pulse-coding";
import type { PulseAssessment } from "@shared/pulse-assessment";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { PulseScorer } from "./pulse-score.ts";
import { PulseScoreState } from "./pulse-score-state.ts";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { workoutsKey } from "@shared/workouts";
const T = 1_800_000_000_000;
function setup() {
  let now = T + CODING_WINDOW_MS + 120_000;
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
  assert.equal(calls, 4); assert.equal(peak, 3); assert.equal(errors.length, 1);
  const rows = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map(parseCodingAssessment);
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
 assert.ok(b.requests.some((request)=>JSON.stringify(request.state).includes('"peakWatts":72.5')));
 const rows=await b.storage.listRange(pulseAssessmentsKey(),0,-1);
 assert.equal(new Set(rows.map((r)=>JSON.parse(r).domain)).size,6);
 b.advance(CODING_WINDOW_MS);await b.make().run();assert.equal(b.requests.length,6);
});

test('listening marks score windows with no live samples and claim at most one window', async () => {
  const b = setup();
  await b.storage.append(listeningPlaysKey(), JSON.stringify({ t: T + 240_000, since: T + 120_000, hint: 'Hamilton' }));
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const state = b.requests[0].state as Record<string, unknown>;
  assert.equal(state.playingSeconds, 0, '实测只算上报，痕迹不掺进去');
  assert.deepEqual(state.recentPlays, [{ title: 'Hamilton', gap: 'within five minutes' }]);
  assert.ok(!JSON.stringify(state).includes(String(T)), '发给 Jev 的 state 里没有时间戳');
  assert.deepEqual(Object.keys(b.requests[0].questions as object), ['intensity', 'continuity', 'mode']);
  const row = JSON.parse((await b.storage.listRange(pulseAssessmentsKey(), 0, -1))[0]) as { domain: string; coverage: { from: number; to: number }[]; mode: { value: string } | null };
  assert.equal(row.domain, 'listening');
  assert.deepEqual(row.coverage, [{ from: T + 120_000, to: T + 240_000 }]);
  assert.equal(row.mode?.value, 'traces');
});

test('a listening mark after hours of silence still claims only one window of time', async () => {
  const b = setup();
  await b.storage.append(listeningPlaysKey(), JSON.stringify({ t: T + 240_000, since: T - 6 * 3_600_000, hint: null }));
  await b.make().run();
  // 认领区间可以跨过五分钟的边界，落在两个窗口上，但加起来仍不超过一个窗口。
  const claimed = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1))
    .flatMap((raw) => (JSON.parse(raw) as { coverage: { from: number; to: number }[] }).coverage)
    .reduce((sum, part) => sum + (part.to - part.from), 0);
  assert.equal(claimed, CODING_WINDOW_MS);
  assert.ok(b.requests.length <= 2);
});

test('listening windows without marks stay frozen when an unrelated mark arrives', async () => {
  const b = setup();
  await b.storage.append(pulseKey('listening'), JSON.stringify({ t: T, until: T + CODING_WINDOW_MS, level: 3, hint: 'A' }));
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const before = await b.storage.listRange(pulseAssessmentsKey(), 0, -1);
  assert.deepEqual((b.requests[0].state as { recentPlays: unknown[] }).recentPlays, []);
  // 痕迹落在上一个窗口：那个窗口该打分，这个窗口的 inputHash 不能因此变。
  await b.storage.append(listeningPlaysKey(), JSON.stringify({ t: T - 60_000, since: T - 120_000, hint: null }));
  b.advance(CODING_WINDOW_MS);
  await b.make().run();
  assert.equal(b.requests.length, 2);
  assert.equal((b.requests[1].state as { recentPlays: unknown[] }).recentPlays.length, 1);
  const rows = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as { from: number; inputHash: string });
  assert.equal(rows.find((row) => row.from === T)!.inputHash, (JSON.parse(before[0]) as { inputHash: string }).inputHash);
});

test('listening counts track changes in code and hands Jev named seconds, never raw segments', async () => {
  const b = setup();
  for (const [i, hint] of ['A', 'B', 'C', 'C'].entries())
    await b.storage.append(pulseKey('listening'), JSON.stringify({ t: T + i * 60_000, level: 3, hint }));
  await b.make().run();
  const state = b.requests[0].state as Record<string, unknown>;
  assert.equal(state.trackChanges, 2);
  assert.equal(state.distinctTracks, 3);
  assert.equal(state.playingSeconds, 300);
  assert.equal(state.playingPercent, 100);
  assert.equal(state.longestPlayingRunPercent, 100);
  assert.equal('segments' in state, false);
  assert.equal('legend' in state, false);
});

test("activity sends a named workout into the Jev state and scores a window the rings missed", async () => {
  const b = setup();
  await b.storage.set(workoutsKey(), JSON.stringify({
    pushedAt: T,
    items: [{
      id: "e3389897-4be9-45af-9e5d-be7480a89b50",
      activityType: "Fencing",
      startedAt: T,
      endedAt: T + CODING_WINDOW_MS,
      secondsFromGMT: 28_800,
      durationSeconds: 300,
      distanceMeters: null,
      activeEnergyKcal: 200,
      averageHeartRateBpm: null,
      maximumHeartRateBpm: null,
      elevationAscendedMeters: null,
      indoor: false,
    }],
  }));
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const state = b.requests[0].state as {
    workoutPercent: number;
    vigorousSeconds: number;
    workouts: { activityType: string; seconds: number }[];
  };
  assert.deepEqual(state.workouts, [{ activityType: "Fencing", seconds: 300 }]);
  assert.equal(state.workoutPercent, 100);
  assert.equal(state.vigorousSeconds, 0);
  assert.equal(JSON.stringify(state).includes(String(T)), false);
  const questions = b.requests[0].questions as { intensity: { criteria: string[] }; continuity: { criteria: string[] } };
  assert.match(questions.intensity.criteria[4], /`workoutPercent` 50 or above/);
  assert.match(questions.continuity.criteria[3], /`workoutPercent` 75 or above/);
  const row = JSON.parse((await b.storage.listRange(pulseAssessmentsKey(), 0, -1))[0]) as { domain: string };
  assert.equal(row.domain, "activity");
});

function assessment(domain: PulseDomain, from: number, scoredAt: number, inputHash = "hash"): PulseAssessment {
  return {
    domain,
    from,
    to: from + CODING_WINDOW_MS,
    coverage: [{ from, to: from + CODING_WINDOW_MS }],
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

test("pulse score state: an activity history revision rejects stale activity results only", async () => {
  const b = setup();
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  await b.storage.set(pulseIntervalRevisionKey("activity"), "1");

  const activity = assessment("activity", T, b.now(), "stale-activity");
  const coding = assessment("coding", T, b.now(), "current-coding");
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [activity, coding]), true);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.deepEqual(saved.map((row) => row.inputHash), ["current-coding"]);
});

test("pulse score state: commit merges at submit time and splits lists above 10000 values", async () => {
  const b = setup();
  const state = b.coordinator();
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  const records = Array.from({ length: 10_001 }, (_, index) => {
    const domain = PULSE_DOMAINS[index % PULSE_DOMAINS.length];
    const from = T - Math.floor(index / PULSE_DOMAINS.length) * CODING_WINDOW_MS;
    return assessment(domain, from, b.now(), `hash-${index}`);
  });
  const concurrent = assessment("activity", T + CODING_WINDOW_MS, b.now(), "concurrent");
  await b.storage.append(pulseAssessmentsKey(), JSON.stringify(concurrent));
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, records), true);
  const saved = (await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).map((raw) => JSON.parse(raw) as PulseAssessment);
  assert.equal(saved.length, 10_002);
  assert.ok(saved.some((record) => record.inputHash === "concurrent"));
});
