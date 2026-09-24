import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateCursorCost,
  parseModelsDev,
  refreshOnlinePrices,
  setOnlinePrices,
} from "../dist/cursor-pricing.js";

const at = Date.parse("2026-09-23T12:00:00Z");

/** 凑够 20 个官方型号，过「少得离谱就不收」那道闸 */
function filler(): Record<string, unknown> {
  const models: Record<string, unknown> = {};
  for (let index = 0; index < 20; index += 1) {
    models[`filler-${index}`] = { cost: { input: 1, output: 1 } };
  }
  return models;
}

const body = {
  // 聚合商排在前面也不认
  openrouter: { models: { "brand-new-1.0": { cost: { input: 99, output: 99 } } } },
  xai: {
    models: {
      "brand-new-1.0": {
        cost: {
          input: 2,
          output: 6,
          cache_read: 0.5,
          tiers: [
            { input: 8, output: 24, cache_read: 2, tier: { type: "context", size: 500_000 } },
            { input: 4, output: 12, cache_read: 1, tier: { type: "context", size: 200_000 } },
          ],
        },
      },
      "only-over.1": { cost: { input: 1, output: 2, context_over_200k: { input: 3, output: 4 } } },
      "no-price": { cost: { input: 1 } },
    },
  },
  meta: { models: { ...filler(), "brand-new-1.0": { cost: { input: 50, output: 50 } } } },
};

test("parseModelsDev 只认官方厂商，同名先到先得，键把点换成连字符", () => {
  const prices = parseModelsDev(body);
  assert.deepEqual(prices["brand-new-1-0"]?.base, { input: 2, output: 6, cacheRead: 0.5, cacheCreation: null });
  // 多档取最小门槛
  assert.equal(prices["brand-new-1-0"]?.threshold, 200_000);
  assert.equal(prices["brand-new-1-0"]?.longContext?.input, 4);
  // 只有 context_over_200k 的按 20 万
  assert.equal(prices["only-over-1"]?.threshold, 200_000);
  assert.equal(prices["only-over-1"]?.longContext?.output, 4);
  assert.equal(prices["no-price"], undefined);
});

test("在线价目优先于快照，没有的型号退回快照", async () => {
  setOnlinePrices(null);
  assert.equal(estimateCursorCost("brand-new-1.0", 1_000_000, 0, 0, 0, at), null);
  await refreshOnlinePrices(at, async () => new Response(JSON.stringify(body)));
  assert.equal(estimateCursorCost("brand-new-1.0", 100_000, 0, 0, 0, at), 0.2);
  assert.equal(estimateCursorCost("brand-new-1.0", 250_000, 0, 0, 0, at), 1);
  // 快照里有、在线那份没有的照样有价
  assert.notEqual(estimateCursorCost("claude-sonnet-4-5", 1_000, 1_000, 0, 0, at), null);
  setOnlinePrices(null);
});

test("取失败或结构不对时沿用上一份，6 小时内不重复取", async () => {
  setOnlinePrices(null);
  await refreshOnlinePrices(at, async () => new Response(JSON.stringify(body)));
  let calls = 0;
  const broken = async () => {
    calls += 1;
    return new Response("{}");
  };
  await refreshOnlinePrices(at + 3_600_000, broken);
  assert.equal(calls, 0);
  await refreshOnlinePrices(at + 7 * 3_600_000, broken);
  assert.equal(calls, 1);
  assert.equal(estimateCursorCost("brand-new-1.0", 100_000, 0, 0, 0, at), 0.2);
  await refreshOnlinePrices(at + 8 * 3_600_000, async () => new Response("down", { status: 503 }));
  assert.equal(estimateCursorCost("brand-new-1.0", 100_000, 0, 0, 0, at), 0.2);
  setOnlinePrices(null);
});
