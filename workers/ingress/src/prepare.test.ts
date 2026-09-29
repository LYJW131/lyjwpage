import assert from "node:assert/strict";
import test from "node:test";

import { prepareAgentLimits } from "@shared/ingest/agents";
import { parseAppleMusicCredentials, prepareTelemetryEnvelope } from "@shared/ingest/telemetry";

test("parseAppleMusicCredentials：只收 musicUserToken，去掉首尾空白", () => {
  assert.deepEqual(parseAppleMusicCredentials({ musicUserToken: " token-value " }), { musicUserToken: "token-value" });
});

test("parseAppleMusicCredentials：旧合同的 developerToken / expiresAt 直接拒掉", () => {
  for (const row of [
    { musicUserToken: "u", developerToken: "d" },
    { musicUserToken: "u", expiresAt: 1 },
    { developerToken: "d", expiresAt: 1 },
  ]) {
    assert.throws(() => parseAppleMusicCredentials(row), /developerToken 已停用/);
  }
});

test("parseAppleMusicCredentials：不是对象或 token 为空都报错", () => {
  assert.throws(() => parseAppleMusicCredentials(null), /必须是对象/);
  assert.throws(() => parseAppleMusicCredentials(["x"]), /必须是对象/);
  assert.throws(() => parseAppleMusicCredentials({}), /不能为空/);
  assert.throws(() => parseAppleMusicCredentials({ musicUserToken: "   " }), /不能为空/);
  assert.throws(() => parseAppleMusicCredentials({ musicUserToken: 42 }), /不能为空/);
});

const NOW = Date.parse("2026-09-29T04:00:00Z");

function usageReport() {
  return {
    agents: [{
      id: "claude", state: "ok", collectedAt: NOW - 60_000, sessionCount: 12,
      days: [{
        date: "2026-09-29", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4, reasoningTokens: 0,
        totalTokens: 10, apiEquivalentCostUSD: 0.01, costComplete: true, models: [{ model: "claude-opus-5", tokens: 10 }],
      }],
    }],
  };
}

const activityReport = () => ({ collectedAt: NOW, agents: [{ id: "claude", lastActivityAt: NOW - 30_000, model: "claude-opus-5" }] });

function mac(modules: Record<string, unknown>) {
  return { version: 4, presence: "online", heartbeatAt: NOW, activeModules: ["coding"], modules };
}

test("Mac 信封：认得的模块都收下，ignored 与 rejected 为空", () => {
  const prepared = prepareTelemetryEnvelope(mac({
    desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode" },
    timezone: { identifier: "Asia/Shanghai", secondsFromGMT: 28_800 },
    appleMusic: { state: "paused", title: "Song" },
    appleMusicCredentials: { musicUserToken: "token" },
    chargingDevices: { devices: [] },
    codingUsage: usageReport(),
    codingActivity: activityReport(),
    codingTokenBuckets: { from: NOW - 600_000, to: NOW, collectedAt: NOW, agents: [{ id: "claude", state: "ok" }], windows: [] },
  }), NOW);
  assert.deepEqual(prepared.ignored, []);
  assert.deepEqual(prepared.rejected, []);
  assert.equal(prepared.failure, undefined);
  assert.equal(prepared.modules.codingUsage?.agents[0]?.sessionCount, 12);
  assert.equal(prepared.modules.codingActivity?.agents[0]?.lastActivityAt, NOW - 30_000);
  assert.deepEqual(prepared.modules.codingTokenBuckets?.windows, []);
});

test("Mac 信封：不认识的模块（含改名前的 vibeCoding*）进 ignored，不影响别的模块", () => {
  const prepared = prepareTelemetryEnvelope(mac({
    vibeCodingUsage: { agents: [] },
    vibeCodingNow: { agents: [] },
    vibeCodingYear: {},
    somethingNew: 1,
    codingActivity: activityReport(),
  }), NOW);
  assert.deepEqual(prepared.ignored, ["vibeCodingUsage", "vibeCodingNow", "vibeCodingYear", "somethingNew"]);
  assert.deepEqual(Object.keys(prepared.modules), ["codingActivity"]);
  assert.deepEqual(prepared.rejected, []);
});

test("Mac 信封：坏的 coding 模块只丢它自己，原因带路径，别的模块照收、不算分段失败", () => {
  const broken = usageReport();
  broken.agents[0]!.days[0]!.totalTokens = 5;
  const prepared = prepareTelemetryEnvelope(mac({
    desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode" },
    codingUsage: broken,
    codingActivity: activityReport(),
    codingTokenBuckets: null,
  }), NOW);
  assert.equal(prepared.failure, undefined);
  assert.equal(prepared.modules.desktop?.activity?.applicationName, "Xcode");
  assert.ok(prepared.modules.codingActivity);
  assert.equal("codingUsage" in prepared.modules, false);
  assert.equal("codingTokenBuckets" in prepared.modules, false);
  assert.deepEqual(prepared.rejected, [
    { module: "codingUsage", error: "agents[0].days[0].totalTokens 小于四列之和" },
    { module: "codingTokenBuckets", error: "必须是对象" },
  ]);
});

test("Mac 信封：前面的模块分段失败时 coding 模块不挂上（状态核心在那里就抛），拒收照记", () => {
  const prepared = prepareTelemetryEnvelope(mac({
    desktop: { bundleIdentifier: "com.apple.dt.Xcode" },
    codingUsage: usageReport(),
    codingActivity: { collectedAt: "now", agents: [] },
  }), NOW);
  assert.equal(prepared.failure?.stage, "beforeDesktop");
  assert.equal("codingUsage" in prepared.modules, false);
  assert.deepEqual(prepared.rejected.map((entry) => entry.module), ["codingActivity"]);
});

test("agents 信封：限额照写，坏的 coding 数据只丢它自己", () => {
  const prepared = prepareAgentLimits({
    agents: [{ id: "cursor", plan: { tier: "ultra" }, limits: [] }],
    collectedAt: new Date(NOW).toISOString(),
    codingUsage: { agents: [{ id: "Cursor", state: "ok", collectedAt: NOW, days: [] }] },
    codingActivity: { collectedAt: NOW, agents: [{ id: "cursor", lastActivityAt: NOW - 1_000, model: "composer-2" }] },
  }, NOW);
  assert.deepEqual(prepared.limits?.agents.map((row) => row.id), ["cursor"]);
  assert.equal(prepared.codingActivity?.agents[0]?.model, "composer-2");
  assert.equal(prepared.codingUsage, undefined);
  assert.deepEqual(prepared.rejected.map((entry) => entry.module), ["codingUsage"]);
  assert.match(prepared.rejected[0]!.error, /^agents\[0\]\.id 必须匹配/);
});

test("agents 信封：只有 coding 数据也收，不碰限额", () => {
  const prepared = prepareAgentLimits({ collectedAt: new Date(NOW).toISOString(), codingActivity: activityReport() }, NOW);
  assert.equal(prepared.limits, null);
  assert.ok(prepared.codingActivity);
  assert.deepEqual(prepared.rejected, []);
});

test("agents 信封：被拒的不算带了 —— 一份可收的都没有就整封拒收，原因写进错误", () => {
  assert.throws(
    () => prepareAgentLimits({ codingActivity: { collectedAt: NOW + 3_600_000, agents: [] } }, NOW),
    { message: "agents 上报没有可收的数据：codingActivity：collectedAt 晚于收到时刻超过 60 秒" },
  );
  assert.throws(() => prepareAgentLimits({ collectedAt: new Date(NOW).toISOString() }, NOW), { message: /至少要带限额或一份 coding 数据/ });
  // 改名前的 cursorUsage / cursorNow 不再是数据
  assert.throws(
    () => prepareAgentLimits({ cursorNow: { lastActivityAt: new Date(NOW).toISOString(), currentModel: "x" } }, NOW),
    { message: /至少要带限额或一份 coding 数据/ },
  );
  assert.throws(() => prepareAgentLimits(null, NOW), { message: /必须是对象/ });
});

test("agents 信封：限额本身坏了仍然整封拒收，哪怕 coding 数据是好的", () => {
  assert.throws(
    () => prepareAgentLimits({ agents: [{ id: "codex" }, { id: "codex" }], codingActivity: activityReport() }, NOW),
    { message: /id 不能重复/ },
  );
});
