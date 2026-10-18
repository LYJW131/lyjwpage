import assert from "node:assert/strict";
import test from "node:test";

import {
  chargerActive,
  codingLayoutKey,
  liveTrack,
  powerBankActive,
  workoutsLayoutKey,
} from "./home-layout.ts";

test("充电头活跃：连着且总功率高于待机阈值（严格大于 1W）", () => {
  assert.equal(chargerActive(null), false);
  assert.equal(chargerActive(undefined), false);
  assert.equal(chargerActive({ connected: false, totalPower: 50 }), false);
  assert.equal(chargerActive({ connected: true, totalPower: 1 }), false);
  assert.equal(chargerActive({ connected: true, totalPower: 1.5 }), true);
});

test("充电宝活跃：涓流时输入功率可能低于阈值，信固件的充电标志", () => {
  assert.equal(powerBankActive(null), false);
  assert.equal(powerBankActive({ connected: false, charging: true, outputPower: 50 }), false);
  assert.equal(powerBankActive({ connected: true, charging: true, outputPower: 0 }), true);
  assert.equal(powerBankActive({ connected: true, charging: false, outputPower: 2 }), true);
  assert.equal(powerBankActive({ connected: true, charging: false, outputPower: 1 }), false);
  assert.equal(powerBankActive({ connected: true, charging: false, outputPower: 0 }), false);
});

test("liveTrack：有标题且没停才上卡片", () => {
  assert.equal(liveTrack(null), null);
  assert.equal(liveTrack({ title: null, state: "playing" }), null);
  assert.equal(liveTrack({ title: "", state: "playing" }), null);
  assert.equal(liveTrack({ title: "song", state: "stopped" }), null);
  const paused = { title: "song", state: "paused" as const };
  assert.equal(liveTrack(paused), paused);
  const playing = { title: "song", state: "playing" as const };
  assert.equal(liveTrack(playing), playing);
});

test("codingLayoutKey：空载荷是 unavailable；agent 顺序不影响布局键", () => {
  assert.equal(codingLayoutKey(null), "unavailable");
  const empty = { agents: [], totals: null, topModels: [] };
  assert.equal(codingLayoutKey(empty), JSON.stringify({ agents: [], totals: false, topModels: false }));

  const agent = (id: string) => ({ id, sources: [], models: [], latestModel: null, lastDay: null, status: [] });
  const ab = { agents: [agent("a"), agent("b")], totals: null, topModels: [] };
  const ba = { agents: [agent("b"), agent("a")], totals: null, topModels: [] };
  assert.equal(codingLayoutKey(ab), codingLayoutKey(ba));

  const totals = {
    inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0,
    reasoningTokens: 0, totalTokens: 2, apiEquivalentCostUSD: 0, costComplete: true,
    activeDays: 1, modelCount: 0, sessionCount: null,
  };
  const withTotals = { agents: [], totals, topModels: [] };
  assert.notEqual(codingLayoutKey(withTotals), codingLayoutKey(empty));
  const withModels = { agents: [], totals: null, topModels: [{ model: "m", tokens: 1 }] };
  assert.notEqual(codingLayoutKey(withModels), codingLayoutKey(empty));
});

test("workoutsLayoutKey：缺载荷、空列表、有内容三态", () => {
  assert.equal(workoutsLayoutKey(null), "none");
  assert.equal(workoutsLayoutKey({ items: [] }), "empty");
  assert.equal(workoutsLayoutKey({ items: [{}] }), "list");
});
