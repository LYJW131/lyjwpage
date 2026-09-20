import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_SCORE_INTERVAL_MS, PULSE_SCORE_REFRESH_MS } from "@/lib/limits";
import { parsePulseScoreRecord, pulseKey, pulseScoresKey } from "@/lib/pulse";
import { compressPulseWindow, pulseWindowAt } from "@/lib/pulse-window";
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from "@/lib/types";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { PulseScorer, hasFreshSamples, parseJevScores } from "./pulse-score.ts";

/**
 * 评分器守的是三条：十分钟一次、没有新样本不打、失败留着上一份分。
 * 网关用假 fetch 顶替，存储是一张内存表 —— 单测不碰网络，也不碰真 SQLite。
 */

const NOW = 1_770_000_000_000;

function answersFor(score: number, trend = "steady") {
  return {
    answers: Object.fromEntries(PULSE_DOMAINS.flatMap((domain) => [
      [`${domain}Activity`, { type: "score", score, confidence: 0.77, probabilities: { "0": 0.1, "1": 0.9 } }],
      [`${domain}Trend`, { type: "choice", choice: trend, confidence: 0.6, probabilities: { steady: 0.9 } }],
    ])),
    usage: { input_tokens: 425, output_tokens: 12 },
  };
}

function setup(options: {
  lists?: Partial<Record<PulseDomain, PulseSample[]>>;
  stored?: string;
  respond?: (call: number) => Response | Promise<Response>;
} = {}) {
  const entries = new Map<string, string>();
  const lists = new Map<string, string[]>();
  for (const [domain, samples] of Object.entries(options.lists ?? {})) {
    lists.set(pulseKey(domain as PulseDomain), samples.map((sample) => JSON.stringify(sample)));
  }
  if (options.stored) entries.set(pulseScoresKey(), options.stored);

  const storage = new StorageClient(async (commands: StorageCommand[]) => commands.map((command) => {
    switch (command.op) {
      case "get": return entries.get(command.key) ?? null;
      case "set": entries.set(command.key, command.value); return true;
      case "listRange": return lists.get(command.key) ?? [];
      default: throw new Error(`没料到的命令 ${command.op}`);
    }
  }));

  const requests: { body: unknown; headers: Record<string, string> }[] = [];
  let calls = 0;
  const fetchStub = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    requests.push({
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return options.respond
      ? options.respond(calls)
      : Response.json(answersFor(1.68));
  }) as unknown as typeof fetch;

  let now = NOW;
  const errors: unknown[] = [];
  const make = () => new PulseScorer({
    storage,
    apiKey: "test-key",
    fetch: fetchStub,
    now: () => now,
    log: (error) => errors.push(error),
  });
  const scorer = make();
  return {
    scorer,
    /** 模拟 DO 被回收后重建：内存里的尝试时刻归零，存储还是同一份 */
    restart: make,
    requests,
    errors,
    stored: () => parsePulseScoreRecord(entries.get(pulseScoresKey()) ?? null),
    /** 模拟上报器又写了一笔 */
    push: (domain: PulseDomain, sample: PulseSample) => {
      const key = pulseKey(domain);
      lists.set(key, [...(lists.get(key) ?? []), JSON.stringify(sample)]);
    },
    advance: (ms: number) => { now += ms; },
    calls: () => calls,
  };
}

/** 刚刚上报过的一笔：非空闲要在静默上限内，否则窗口里什么都没有 */
function fresh(level: 0 | 1 | 2 | 3 = 3, at = NOW - 60_000): PulseSample[] {
  return [{ t: at, level, hint: "Zed" }];
}

test("有新样本时打一次分，结果按域存下来", async () => {
  const bench = setup({ lists: { coding: fresh(), listening: fresh(2) } });
  await bench.scorer.run();

  assert.equal(bench.calls(), 1);
  const record = bench.stored();
  assert.equal(record?.scoredAt, NOW);
  assert.equal(record?.domains.coding.score, 1.68);
  assert.equal(record?.domains.coding.confidence, 0.77);
  assert.equal(record?.domains.coding.trend, "steady");
  assert.equal(record?.domains.coding.latestSampleAt, NOW - 60_000);
  assert.equal(record?.domains.gaming.latestSampleAt, null);
});

test("请求按 Jev 契约发出：头、十二道题、带 hint 的段", async () => {
  const bench = setup({ lists: { coding: fresh() } });
  await bench.scorer.run();

  const [request] = bench.requests;
  assert.equal(request.headers.Authorization, "Bearer test-key");
  assert.equal(request.headers["Content-Type"], "application/json");
  const body = request.body as { model: string; questions: Record<string, unknown>; state: Record<string, unknown> };
  assert.equal(body.model, "jev-latest");
  assert.equal(Object.keys(body.questions).length, 12);
  // hint 只在这条私下的路径上出现，公开端点那侧另有断言
  assert.equal(JSON.stringify(body.state).includes("Zed"), true);
});

test("十分钟内不再打第二次，哪怕又来了新样本", async () => {
  const bench = setup({ lists: { coding: fresh() } });
  await bench.scorer.run();
  bench.advance(PULSE_SCORE_INTERVAL_MS - 1000);
  bench.push("coding", { t: NOW + 60_000, level: 2 });
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);

  bench.advance(2000);
  await bench.scorer.run();
  assert.equal(bench.calls(), 2);
});

test("没有比上一份分更新的样本就不调用（一小时内；满一小时的重算见下面那条）", async () => {
  const bench = setup({ lists: { coding: fresh() } });
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);

  bench.advance(PULSE_SCORE_REFRESH_MS - 60_000);
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);
  assert.equal(bench.stored()?.scoredAt, NOW);
});

test("一份样本都没有时不调用", async () => {
  const bench = setup();
  await bench.scorer.run();
  assert.equal(bench.calls(), 0);
  assert.equal(bench.stored(), null);
});

test("网关失败留着上一份分，而且下一分钟不重试", async () => {
  const bench = setup({
    lists: { coding: fresh() },
    respond: (call) => call === 1
      ? Response.json(answersFor(2.4))
      : new Response("upstream is down", { status: 503 }),
  });
  await bench.scorer.run();
  const first = bench.stored();
  assert.equal(first?.domains.coding.score, 2.4);

  bench.advance(PULSE_SCORE_INTERVAL_MS + 1000);
  // 这一轮有更新的样本（窗口跟着时间走），但网关 503
  bench.advance(0);
  await bench.scorer.run();
  assert.equal(bench.calls(), 1, "没有新样本时本来就不该再调");

  const busy = setup({
    lists: { coding: fresh(3, NOW - 60_000) },
    respond: () => new Response("upstream is down", { status: 503 }),
  });
  await busy.scorer.run();
  assert.equal(busy.calls(), 1);
  assert.equal(busy.stored(), null);
  assert.equal(busy.errors.length, 1);
  // 失败也记上尝试时刻：cron 下一分钟再来时不该又打一次
  busy.advance(60_000);
  await busy.scorer.run();
  assert.equal(busy.calls(), 1);
});

test("回答缺题或类型不对时整份丢掉", () => {
  const window = pulseWindowAt(NOW);
  const windows = Object.fromEntries(PULSE_DOMAINS.map((domain) => [
    domain,
    compressPulseWindow([], window),
  ])) as Record<PulseDomain, ReturnType<typeof compressPulseWindow>>;

  assert.throws(() => parseJevScores({ answers: {} }, windows, NOW, window), /codingActivity/);
  const missingTrend = answersFor(1.2);
  delete (missingTrend.answers as Record<string, unknown>).gamingTrend;
  assert.throws(() => parseJevScores(missingTrend, windows, NOW, window), /gamingTrend/);
  const badTrend = answersFor(1.2, "sideways");
  assert.throws(() => parseJevScores(badTrend, windows, NOW, window), /Trend/);

  // 没有把握度时按 null 存，不拿一个假的数字充数
  const noConfidence = answersFor(1.2) as { answers: Record<string, { confidence?: unknown }> };
  delete noConfidence.answers.codingActivity.confidence;
  const record = parseJevScores(noConfidence, windows, NOW, window);
  assert.equal(record.domains.coding.confidence, null);
});

test("新样本的判定按域，任意一域更新就够", () => {
  const window = pulseWindowAt(NOW);
  const windows = Object.fromEntries(PULSE_DOMAINS.map((domain) => [
    domain,
    compressPulseWindow(domain === "gaming" ? [{ t: NOW - 60_000, level: 3 }] : [], window),
  ])) as Record<PulseDomain, ReturnType<typeof compressPulseWindow>>;

  assert.equal(hasFreshSamples(windows, null), true);
  const stored = parseJevScores(answersFor(1), windows, NOW, window);
  assert.equal(hasFreshSamples(windows, stored), false);
});

test("没有新样本也每小时重算一次：窗口在走，昨天的活动会滑出去", async () => {
  const bench = setup({ lists: { coding: fresh() } });
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);

  // 半小时后没新样本：不调
  bench.advance(PULSE_SCORE_REFRESH_MS / 2);
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);

  // 满一小时：同一份样本也重算，scoredAt 往前走
  bench.advance(PULSE_SCORE_REFRESH_MS / 2);
  await bench.scorer.run();
  assert.equal(bench.calls(), 2);
  assert.equal(bench.stored()?.scoredAt, NOW + PULSE_SCORE_REFRESH_MS);

  // 一笔样本都没有的窗口就算分再老也不重算
  const empty = setup({ stored: JSON.stringify(bench.stored()) });
  empty.advance(PULSE_SCORE_REFRESH_MS * 3);
  await empty.scorer.run();
  assert.equal(empty.calls(), 0);
});

test("失败的尝试时刻落盘：DO 重建后仍不会每分钟重试", async () => {
  const bench = setup({
    lists: { coding: fresh() },
    respond: () => new Response("upstream is down", { status: 503 }),
  });
  await bench.scorer.run();
  assert.equal(bench.calls(), 1);

  bench.advance(60_000);
  await bench.restart().run();
  assert.equal(bench.calls(), 1, "新实例读到存储里的尝试时刻，不重试");

  bench.advance(PULSE_SCORE_INTERVAL_MS);
  await bench.restart().run();
  assert.equal(bench.calls(), 2, "过了间隔才再试");
});
