import assert from "node:assert/strict";
import test from "node:test";

import { codingBucketsKey } from "@shared/coding-store";
import { PULSE_TTL_MS } from "@shared/limits";
import { parsePulseAssessment, type PulseAssessment } from "@shared/pulse-assessment";
import type { StorageCommand } from "@shared/storage-contract";
import { codingObservationsKey, cursorObservationsKey } from "./coding-pulse";
import { pulseAssessmentAttemptKey, pulseAssessmentsKey } from "./pulse-assessments";
import { PULSE_SCORE_LEASE_MS, PulseScoreState, type PulseStateSql } from "./pulse-score-state";

function assessment(from: number, extra: Partial<PulseAssessment> = {}): PulseAssessment {
  return {
    domain: "coding",
    from,
    to: from + 300_000,
    coverage: [{ from, to: from + 300_000 }],
    intensity: { value: 3, confidence: 0.8, probabilities: { "0": 0, "1": 0, "2": 0, "3": 1, "4": 0 } },
    continuity: { value: 2, confidence: 0.8, probabilities: { "0": 0, "1": 0, "2": 1, "3": 0 } },
    mode: { value: "mixed", confidence: 0.8, probabilities: { idle: 0, brief: 0, interactive: 0, agent: 0, mixed: 1 } },
    inputHash: "h",
    model: "clef",
    scoredAt: from + 300_000,
    ...extra,
  };
}

type SqlValue = string | number | null;

function fakeSql() {
  const metadata = new Map<string, string>();
  const sql: PulseStateSql = {
    exec(query: string, ...bindings: SqlValue[]) {
      if (query.startsWith("SELECT")) {
        const value = metadata.get(String(bindings[0]));
        return { toArray: () => (value === undefined ? [] : [{ value }]) };
      }
      metadata.set(String(bindings[0]), String(bindings[1]));
      return { toArray: () => [] };
    },
  };
  return { sql, metadata };
}

function fakeStore() {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const expiries = new Map<string, number>();
  const execute = (commands: StorageCommand[]): unknown[] => commands.map((command) => {
    switch (command.op) {
      case "get": return strings.get(command.key) ?? null;
      case "set": strings.set(command.key, command.value); return true;
      case "remove": return (strings.delete(command.key) || lists.delete(command.key)) ? 1 : 0;
      case "append": {
        const list = lists.get(command.key) ?? [];
        list.push(...command.values);
        lists.set(command.key, list);
        return list.length;
      }
      case "listRange": case "trim": {
        const list = lists.get(command.key) ?? [];
        const from = command.start < 0 ? Math.max(list.length + command.start, 0) : command.start;
        const to = command.stop < 0 ? list.length + command.stop : Math.min(command.stop, list.length - 1);
        const sliced = list.slice(from, to + 1);
        if (command.op === "listRange") return sliced;
        lists.set(command.key, sliced);
        return true;
      }
      case "expire": expiries.set(command.key, command.ttlMs); return 1;
      case "fields": return {};
      case "patch": return 0;
    }
  });
  return { execute, strings, lists, expiries };
}

function harness(now: number) {
  const { sql, metadata } = fakeSql();
  const store = fakeStore();
  let tick = now, sequence = 0;
  const state = new PulseScoreState({
    sql,
    execute: store.execute,
    now: () => tick,
    token: () => `tok-${++sequence}`,
  });
  return { metadata, store, state, at: (t: number) => { tick = t; } };
}

test("首次领取给出租约、代号和输入快照", async () => {
  const { store, state } = harness(300_000);
  store.lists.set(codingObservationsKey(), ["obs-1"]);
  store.lists.set(cursorObservationsKey(), ["cur-1"]);
  store.strings.set(codingBucketsKey("mac"), "mac-buckets");
  const claim = await state.claimPulseScore();
  assert.equal(claim?.generation, 1);
  assert.equal(claim?.token, "tok-1");
  assert.equal(claim?.now, 300_000);
  assert.equal(claim?.leaseUntil, 300_000 + PULSE_SCORE_LEASE_MS);
  assert.deepEqual(claim?.inputs, {
    assessments: [],
    codingObservations: ["obs-1"],
    cursorObservations: ["cur-1"],
    tokenBuckets: { mac: "mac-buckets", agents: null, "agents-otlp": null, "mac-otlp": null },
  });
});

test("租约未过期不能再领；空结果提交直接释放，同窗口还能再领", async () => {
  const { state } = harness(300_000);
  const first = await state.claimPulseScore();
  assert.ok(first);
  assert.equal(await state.claimPulseScore(), null);

  assert.equal(await state.finishPulseScore(first.token, first.generation, []), true);
  assert.equal((await state.claimPulseScore())?.generation, 2);
});

test("激活后才记尝试时段：同一窗口内租约过期也不能再领", async () => {
  const { state, at } = harness(300_000);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);

  at(300_000 + PULSE_SCORE_LEASE_MS + 1);
  assert.equal(await state.claimPulseScore(), null);

  at(600_000);
  assert.equal((await state.claimPulseScore())?.generation, 2);
});

test("重复激活直接放行，错误的 token 或代号不能激活也不能提交", async () => {
  const { state } = harness(300_000);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.activatePulseScore("not-the-token", claim.generation), false);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation + 1), false);
  assert.equal(await state.finishPulseScore("not-the-token", claim.generation, []), false);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation + 1, []), false);

  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), true);
});

test("租约过期后激活与提交都被拒", async () => {
  const { state, at } = harness(300_000);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  at(300_000 + PULSE_SCORE_LEASE_MS + 1);
  assert.equal(await state.activatePulseScore(claim.token, claim.generation), false);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, []), false);
});

test("没激活不能提交非空结果；无效结果抛错且租约留给下一轮", async () => {
  const { state } = harness(300_000);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [assessment(0)]), false);

  await state.activatePulseScore(claim.token, claim.generation);
  const bad = {
    ...assessment(0),
    intensity: { value: 9, confidence: 0.5, probabilities: { "0": 1, "1": 0, "2": 0, "3": 0, "4": 0 } },
  };
  await assert.rejects(state.finishPulseScore(claim.token, claim.generation, [bad]));
  assert.equal(await state.claimPulseScore(), null);
});

test("提交把结果追加进列表并写 TTL", async () => {
  const { store, state } = harness(300_000);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  await state.activatePulseScore(claim.token, claim.generation);
  const record = assessment(0);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [record]), true);

  const stored = store.lists.get(pulseAssessmentsKey()) ?? [];
  assert.equal(stored.length, 1);
  assert.deepEqual(parsePulseAssessment(stored[0]), record);
  assert.equal(store.expiries.get(pulseAssessmentsKey()), PULSE_TTL_MS);
});

test("被覆盖行没过半只追加，过半才 remove 后按有序行重写", async () => {
  const { store, state, at } = harness(300_000);
  store.lists.set(pulseAssessmentsKey(), [
    JSON.stringify(assessment(0, { inputHash: "old" })),
    JSON.stringify(assessment(300_000, { inputHash: "keep" })),
  ]);
  let claim = await state.claimPulseScore();
  assert.ok(claim);
  await state.activatePulseScore(claim.token, claim.generation);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [assessment(0, { inputHash: "new" })]), true);
  assert.deepEqual(
    (store.lists.get(pulseAssessmentsKey()) ?? []).map((raw) => (JSON.parse(raw) as PulseAssessment).inputHash),
    ["old", "keep", "new"],
  );

  at(600_000);
  store.lists.set(pulseAssessmentsKey(), [
    JSON.stringify(assessment(0, { inputHash: "a" })),
    JSON.stringify(assessment(0, { inputHash: "b" })),
    JSON.stringify(assessment(0, { inputHash: "c" })),
  ]);
  claim = await state.claimPulseScore();
  assert.ok(claim);
  await state.activatePulseScore(claim.token, claim.generation);
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [assessment(0, { inputHash: "new" })]), true);
  assert.deepEqual(
    (store.lists.get(pulseAssessmentsKey()) ?? []).map((raw) => (JSON.parse(raw) as PulseAssessment).inputHash),
    ["new"],
  );
});

test("超出保留期的旧评估在重写时丢掉", async () => {
  const { store, state } = harness(700_000_000);
  store.lists.set(pulseAssessmentsKey(), [JSON.stringify(assessment(0, { inputHash: "ancient" }))]);
  const claim = await state.claimPulseScore();
  assert.ok(claim);
  await state.activatePulseScore(claim.token, claim.generation);
  const fresh = assessment(699_900_000, { inputHash: "fresh" });
  assert.equal(await state.finishPulseScore(claim.token, claim.generation, [fresh]), true);
  const stored = (store.lists.get(pulseAssessmentsKey()) ?? []).map((raw) => (JSON.parse(raw) as PulseAssessment).inputHash);
  assert.deepEqual(stored, ["fresh"]);
});

test("读输入快照失败时租约当场释放，下一轮能重新领", async () => {
  const { sql } = fakeSql();
  let fail = true;
  const execute = (commands: StorageCommand[]): unknown[] => {
    if (fail && commands.some((command) => command.op === "listRange")) throw new Error("存储挂了");
    return commands.map(() => null);
  };
  const state = new PulseScoreState({ sql, execute, now: () => 300_000, token: () => "tok" });
  await assert.rejects(state.claimPulseScore());
  fail = false;
  assert.equal((await state.claimPulseScore())?.generation, 2);
});

test("存的协调状态坏了按首次来", async () => {
  const { metadata, state } = harness(300_000);
  metadata.set("pulse-score:state", "{这不是 JSON");
  assert.equal((await state.claimPulseScore())?.generation, 1);
});

test("存的 claim 与代号对不上按首次来", async () => {
  const { metadata, state } = harness(300_000);
  metadata.set("pulse-score:state", JSON.stringify({
    generation: 5,
    attemptedAt: 0,
    claim: { token: "x", generation: 3, leaseUntil: 999_999_999 },
  }));
  assert.equal((await state.claimPulseScore())?.generation, 1);
});

test("没有协调状态时旧的尝试时刻键仍然挡住同一窗口", async () => {
  const { store, state } = harness(300_000);
  store.strings.set(pulseAssessmentAttemptKey(), String(450_000));
  assert.equal(await state.claimPulseScore(), null);
});
