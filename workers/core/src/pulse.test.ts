import assert from "node:assert/strict";
import test from "node:test";

import {
  activityLaneView,
  chargingLaneView,
  codingLaneView,
  pulseWindowAt,
  stateLaneView,
  tokensLaneView,
} from "./pulse";
import type { StoredCodingBuckets } from "@shared/coding-buckets";
import type { CodingTokenBucketRow } from "@shared/coding-usage";
import type { CodingObservation } from "@shared/pulse-coding";
import type { Coverage } from "@shared/pulse-features";
import type { ListeningTrace } from "@shared/pulse-listening";

const W = { from: 0, to: 600_000 };

test("pulse 窗口是此刻往前 24 小时", () => {
  assert.deepEqual(pulseWindowAt(1_700_000_000_000), {
    from: 1_700_000_000_000 - 86_400_000,
    to: 1_700_000_000_000,
  });
});

test("状态道按列输出，时刻换算成相对窗口的整秒，标题只出在非空闲段", () => {
  const lane = stateLaneView("watching", {
    closed: [
      { state: "idle", itemId: null, title: null, subtitle: null, from: 0, to: 60_000 },
      { state: "playing", itemId: "ep1", title: "葬送的芙莉莲", subtitle: "S1E5", from: 60_000, to: 300_000 },
    ],
    open: null,
  }, W);
  assert.deepEqual(lane.segments, {
    startSec: [0, 60],
    endSec: [60, 300],
    state: [0, 2],
    title: [null, "葬送的芙莉莲"],
    subtitle: [null, "S1E5"],
  });
  assert.deepEqual(lane.summary, { activeSeconds: 240, titles: 1 });
});

test("gaming 道：离线 0、在线 1、在游戏中 2，标题只随游戏段给出", () => {
  const lane = stateLaneView("gaming", {
    closed: [
      { state: "offline", titleId: null, title: null, from: 0, to: 100_000 },
      { state: "online", titleId: null, title: null, from: 100_000, to: 200_000 },
      { state: "in-game", titleId: "PPSA0123", title: "艾尔登法环", from: 200_000, to: 500_000 },
    ],
    open: null,
  }, W);
  assert.deepEqual(lane.segments.state, [0, 1, 2]);
  assert.deepEqual(lane.segments.title, [null, null, "艾尔登法环"]);
  assert.equal(lane.uncertain, undefined);
  assert.deepEqual(lane.summary, { activeSeconds: 300, titles: 1 });
});

test("开着的段：有效期内画到窗口末尾，过宽限只画到确实知道的那一刻", () => {
  const live = stateLaneView("listening", {
    closed: [],
    open: {
      state: "playing", source: "mac", title: "群青", artist: "YOASOBI", album: null, trackId: null,
      from: 60_000, seenAt: 120_000, holdUntil: null, endsBy: null,
    },
  }, W);
  assert.deepEqual(live.segments.startSec, [60]);
  assert.deepEqual(live.segments.endSec, [600]);

  const expired = stateLaneView("listening", {
    closed: [],
    open: {
      state: "playing", source: "mac", title: "群青", artist: "YOASOBI", album: null, trackId: null,
      from: 60_000, seenAt: 120_000, holdUntil: 300_000, endsBy: null,
    },
  }, W);
  assert.deepEqual(expired.segments.endSec, [120]);
});

test("宽限过期后 endsBy 把段延到曲目该结束的那一刻", () => {
  const lane = stateLaneView("listening", {
    closed: [],
    open: {
      state: "playing", source: "homepod", title: "长歌", artist: null, album: null, trackId: null,
      from: 60_000, seenAt: 60_000, holdUntil: 120_000, endsBy: 500_000,
    },
  }, W);
  assert.deepEqual(lane.segments.endSec, [500]);
});

test("听歌道的暂停段最多画满十分钟", () => {
  const lane = stateLaneView("listening", {
    closed: [
      { state: "paused", source: "mac", title: "歌", artist: null, album: null, trackId: null, from: 0, to: 86_400_000 },
    ],
    open: null,
  }, { from: 0, to: 86_400_000 });
  assert.deepEqual(lane.segments.endSec, [600]);
});

test("titles 按歌名小写去重，暂停段不算", () => {
  const lane = stateLaneView("listening", {
    closed: [
      { state: "playing", source: "mac", title: "Song", artist: "a", album: null, trackId: null, from: 0, to: 100_000 },
      { state: "paused", source: "mac", title: "Other", artist: "b", album: null, trackId: null, from: 100_000, to: 200_000 },
      { state: "playing", source: "mac", title: "SONG", artist: "a", album: null, trackId: null, from: 200_000, to: 300_000 },
    ],
    open: null,
  }, W);
  assert.equal(lane.summary.titles, 1);
  assert.equal(lane.summary.activeSeconds, 200);
});

const TRACE: ListeningTrace = {
  since: 0, t: 60_000, title: "夜に駆ける", artist: "YOASOBI", album: null,
  itemId: null, durationMs: 180_000, songId: null, artworkUrl: null,
};

test("别处播放进 uncertain，activeSeconds 取与实测在放的并集", () => {
  const lane = stateLaneView("listening", { closed: [], open: null }, W, [TRACE]);
  assert.deepEqual(lane.uncertain, {
    startSec: [25],
    endSec: [205],
    title: ["夜に駆ける"],
    subtitle: ["YOASOBI"],
    marginSec: [30],
  });
  assert.equal(lane.summary.activeSeconds, 180);
  assert.equal(lane.summary.titles, 1);
});

test("同一首歌已被实测在放解释的推断不再进 uncertain", () => {
  const lane = stateLaneView("listening", {
    closed: [
      { state: "playing", source: "mac", title: "夜に駆ける", artist: "YOASOBI", album: null, trackId: null, from: 0, to: 300_000 },
    ],
    open: null,
  }, W, [TRACE]);
  assert.deepEqual(lane.uncertain?.startSec, []);
  assert.equal(lane.summary.activeSeconds, 300);

  const different = stateLaneView("listening", {
    closed: [
      { state: "playing", source: "mac", title: "别的歌", artist: "别人", album: null, trackId: null, from: 0, to: 300_000 },
    ],
    open: null,
  }, W, [TRACE]);
  assert.deepEqual(different.uncertain?.title, ["夜に駆ける"]);
});

const OBS = (t: number, extra: Partial<CodingObservation> = {}): CodingObservation => ({
  t, available: true, desktop: null, agents: null, ...extra,
});

test("coding 三色带：前台、agent、同时与覆盖到的空闲", () => {
  const lane = codingLaneView([
    OBS(0, { desktop: { application: "Code", coding: true }, agents: [{ id: "claude", model: null, active: true }] }),
    OBS(180_000, { desktop: { application: "Code", coding: true }, agents: [] }),
    OBS(360_000, { desktop: { application: "Safari", coding: false }, agents: [{ id: "cursor", model: null, active: true }] }),
    OBS(540_000),
  ], [], W);
  assert.deepEqual(lane.segments, {
    startSec: [0, 180, 360, 540],
    endSec: [180, 360, 540, 600],
    value: [3, 1, 2, 0],
    agentSources: [1, 0, 1, 0],
  });
  assert.deepEqual(lane.summary, { humanSeconds: 180, agentSeconds: 180, bothSeconds: 180 });
});

test("available:false 不算观测，不画段", () => {
  const lane = codingLaneView([OBS(0, { available: false })], [], W);
  assert.equal(lane.segments.startSec.length, 0);
  assert.deepEqual(lane.summary, { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 });
});

test("Cursor 只有覆盖没有活动时画 0 而不是留空", () => {
  const lane = codingLaneView([], [{ t: 0, available: true, lastActivityAt: null }], W);
  assert.deepEqual(lane.segments.value, [0]);
  assert.deepEqual(lane.segments.endSec, [600]);
  assert.deepEqual(lane.summary, { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 });
});

test("Cursor 最近活动撑起 agent 段，来源位记 cursor", () => {
  const lane = codingLaneView([], [{ t: 0, available: true, lastActivityAt: 0 }], W);
  assert.deepEqual(lane.segments, {
    startSec: [0, 300],
    endSec: [300, 600],
    value: [2, 0],
    agentSources: [4, 0],
  });
  assert.equal(lane.summary.agentSeconds, 300);
});

test("云端 token 桶是 agent 活动的正证据", () => {
  const lane = codingLaneView([], [], W, [{ from: 0, to: 300_000 }]);
  assert.deepEqual(lane.segments.value, [2]);
  assert.deepEqual(lane.segments.agentSources, [2]);
});

test("同值同来源的相邻观测并成一段", () => {
  const lane = codingLaneView([
    OBS(0, { desktop: { application: "Code", coding: true }, agents: [] }),
    OBS(120_000, { desktop: { application: "Code", coding: true }, agents: [] }),
  ], [], W);
  assert.deepEqual(lane.segments.startSec, [0]);
  assert.deepEqual(lane.segments.endSec, [300]);
});

function tokenRow(id: string, tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number } = {}): CodingTokenBucketRow {
  return {
    id,
    model: null,
    inputTokens: tokens.input ?? 0,
    outputTokens: tokens.output ?? 0,
    cacheReadTokens: tokens.cacheRead ?? 0,
    cacheCreationTokens: tokens.cacheCreation ?? 0,
    reasoningTokens: 0,
    eventCount: null,
  };
}

function bucketStore(
  windows: { from: number; agents: CodingTokenBucketRow[] }[],
  { coverage = [], receivedAt = 0 }: { coverage?: Coverage[]; receivedAt?: number } = {},
): StoredCodingBuckets {
  return { coverage, agents: [], windows, collectedAt: receivedAt, receivedAt };
}

test("tokens 道按桶起点合并各来源，total 含 cache 读写", () => {
  const lane = tokensLaneView({
    mac: bucketStore(
      [{ from: 0, agents: [tokenRow("claude", { input: 100, output: 50, cacheRead: 1_000 })] }],
      { coverage: [{ from: 0, to: 300_000 }], receivedAt: 300_000 },
    ),
    agents: null,
    "agents-otlp": bucketStore(
      [{ from: 0, agents: [tokenRow("claude", { input: 200 })] }],
      { receivedAt: 600_000 },
    ),
  }, W);
  assert.deepEqual(lane.buckets, { startSec: [0], endSec: [300], total: [1350], output: [50], cacheRead: [1000] });
  assert.deepEqual(lane.summary, { peakPerMinute: 270, currentPerMinute: 270, totalTokens: 1350 });
});

test("没有任何桶来源时峰值与当前速率都是 null", () => {
  const lane = tokensLaneView({}, W);
  assert.equal(lane.buckets.startSec.length, 0);
  assert.deepEqual(lane.summary, { peakPerMinute: null, currentPerMinute: null, totalTokens: 0 });
});

test("窗口起点之前的整桶、覆盖不到的桶、零用量的桶都不画", () => {
  const lane = tokensLaneView({
    mac: bucketStore([
      { from: -300_000, agents: [tokenRow("claude", { input: 100 })] },
      { from: 300_000, agents: [tokenRow("claude", { input: 100 })] },
      { from: 0, agents: [tokenRow("claude", { input: 0 })] },
      { from: 60_000, agents: [tokenRow("claude", { input: 240 })] },
    ], { coverage: [{ from: 0, to: 300_000 }], receivedAt: 300_000 }),
  }, W);
  assert.deepEqual(lane.buckets, { startSec: [60], endSec: [300], total: [240], output: [0], cacheRead: [0] });
  assert.equal(lane.summary.peakPerMinute, 60);
  assert.equal(lane.summary.totalTokens, 240);
});

test("不足一分钟的尾巴桶不画也不计入总量", () => {
  const lane = tokensLaneView({
    "agents-otlp": bucketStore(
      [{ from: 540_000, agents: [tokenRow("claude", { input: 600 })] }],
      { receivedAt: 599_999 },
    ),
  }, W);
  assert.equal(lane.buckets.startSec.length, 0);
  assert.deepEqual(lane.summary, { peakPerMinute: null, currentPerMinute: 0, totalTokens: 0 });
});

test("刚好一分钟的末桶照常画", () => {
  const lane = tokensLaneView({
    "agents-otlp": bucketStore(
      [{ from: 540_000, agents: [tokenRow("claude", { input: 600 })] }],
      { receivedAt: 600_000 },
    ),
  }, W);
  assert.deepEqual(lane.buckets.total, [600]);
  assert.equal(lane.summary.currentPerMinute, 600);
});

test("来源还在报但没有用量是 0，来源也没影了是 null", () => {
  const idle = tokensLaneView({
    mac: bucketStore([], { coverage: [{ from: 0, to: 600_000 }], receivedAt: 600_000 }),
  }, W);
  assert.equal(idle.summary.currentPerMinute, 0);

  const stale = tokensLaneView({
    mac: bucketStore(
      [{ from: 0, agents: [tokenRow("claude", { input: 300 })] }],
      { coverage: [{ from: 0, to: 300_000 }], receivedAt: 300_000 },
    ),
  }, { from: 0, to: 1_000_000 });
  assert.equal(stale.summary.currentPerMinute, null);
  assert.equal(stale.summary.peakPerMinute, 60);
});

test("充电道：一笔读数撑到下一笔或十分钟", () => {
  const lane = chargingLaneView([
    { t: 100_000, watts: 65 },
    { t: 400_000, watts: 0 },
  ], W);
  assert.deepEqual(lane.segments, { startSec: [100, 400], endSec: [400, 600], watts: [65, 0] });
  assert.equal(lane.currentPowerW, 0);
  assert.deepEqual(lane.summary, { peakW: 65, energyWh: 5.4 });
});

test("最后一笔读数过期后段只画到有效期，当前功率为 null", () => {
  const lane = chargingLaneView([{ t: 0, watts: 65 }], { from: 0, to: 700_000 });
  assert.deepEqual(lane.segments.endSec, [600]);
  assert.equal(lane.currentPowerW, null);
});

test("相邻同瓦数的读数并成一段", () => {
  const lane = chargingLaneView([{ t: 0, watts: 65 }, { t: 300_000, watts: 65 }], W);
  assert.deepEqual(lane.segments, { startSec: [0], endSec: [600], watts: [65] });
  assert.deepEqual(lane.summary, { peakW: 65, energyWh: 10.8 });
});

test("活动道：无步数的桶不画，跨窗口边界的桶按在内部分摊步数", () => {
  const lane = activityLaneView([
    { from: 0, to: 300_000, steps: 300, moveKcal: null, exerciseMinutes: null },
    { from: 300_000, to: 600_000, steps: null, moveKcal: null, exerciseMinutes: null },
    { from: 600_000, to: 900_000, steps: 400, moveKcal: null, exerciseMinutes: null },
  ], [], W);
  assert.deepEqual(lane.buckets, { startSec: [0], endSec: [300], steps: [300] });
  assert.equal(lane.summary.steps, 300);

  const clipped = activityLaneView([
    { from: 0, to: 300_000, steps: 200, moveKcal: null, exerciseMinutes: null },
  ], [], { from: 150_000, to: 450_000 });
  assert.deepEqual(clipped.buckets.steps, [100]);
  assert.deepEqual(clipped.buckets.endSec, [150]);
  assert.equal(clipped.summary.steps, 100);
});

test("活动道：各桶步数之和等于 summary.steps", () => {
  const lane = activityLaneView([
    { from: -120_000, to: 60_000, steps: 40, moveKcal: null, exerciseMinutes: null },
    { from: 60_000, to: 360_000, steps: 90, moveKcal: null, exerciseMinutes: null },
    { from: 360_000, to: 720_000, steps: 100, moveKcal: null, exerciseMinutes: null },
  ], [], W);
  assert.deepEqual(lane.buckets.steps, [13, 90, 67]);
  assert.equal(lane.summary.steps, 170);
  assert.equal(lane.buckets.steps.reduce((sum, steps) => sum + steps, 0), lane.summary.steps);
});

test("活动道：首尾两个半桶的零头合起来只算一次", () => {
  const lane = activityLaneView([
    { from: -150_000, to: 150_000, steps: 1, moveKcal: null, exerciseMinutes: null },
    { from: 450_000, to: 750_000, steps: 1, moveKcal: null, exerciseMinutes: null },
  ], [], W);
  assert.equal(lane.summary.steps, 1);
  assert.equal(lane.buckets.steps.reduce((sum, steps) => sum + steps, 0), 1);
});

test("训练按窗口裁剪出列", () => {
  const lane = activityLaneView([], [
    { startedAt: -60_000, endedAt: 120_000, activityType: "Cycling" },
    { startedAt: 700_000, endedAt: 800_000, activityType: "Running" },
  ], W);
  assert.deepEqual(lane.workouts, { startSec: [0], endSec: [120], activityType: ["Cycling"] });
});
