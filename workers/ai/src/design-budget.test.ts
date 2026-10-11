import assert from "node:assert/strict";
import test from "node:test";

import { designBudgetFetch, designUsageMicroUsd, emptyDesignBudget, reserveDesignRequest, settleDesignRequest, type DesignBudget, type DesignBudgetStore, type DesignPrices } from "./chat/design-budget.ts";

const PRICES: DesignPrices = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const CENTS = 21;

// 预留按最贵缓存档估算 input：max(5, 0.5, 6.25, 5*2) = 10 USD/M → 10000*10 + 4096*25 = 202400 microUSD。
test("预留按最贵缓存档计费并在成功时记账；重复 id、超上限与请求数封顶一律拒绝", () => {
  const budget = emptyDesignBudget();
  assert.equal(reserveDesignRequest(budget, "r1", 10_000, 4096, PRICES, CENTS), true);
  assert.equal(budget.chargedMicroUsd, 202_400);
  assert.equal(budget.requests, 1);
  assert.equal(budget.reservations.r1, 202_400);
  assert.equal(reserveDesignRequest(budget, "r1", 10_000, 4096, PRICES, CENTS), false);
  // 202400 + 一笔新预留 > 21 美分 = 210000 microUSD：chargedMicroUsd 虽低于上限也被拒。
  assert.equal(reserveDesignRequest(budget, "r2", 1_000, 100, PRICES, CENTS), false);
  assert.equal(budget.requests, 1);
});

// usage{input1000,output1000,read7000,write2000,1hWrite500} = 5000+25000+3500+9375+5000 = 47875 microUSD。
test("结算只认已知完成的用量：缓存读、5 分钟写与 1 小时写按各自档位计", () => {
  const cost = designUsageMicroUsd({ input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 7000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_1h_input_tokens: 500 } }, PRICES);
  assert.equal(cost, 47_875);
  const budget: DesignBudget = { chargedMicroUsd: 202_400, requests: 1, reservations: { r1: 202_400 } };
  settleDesignRequest(budget, "r1", cost!);
  assert.equal(budget.chargedMicroUsd, 47_875);
  assert.deepEqual(budget.reservations, {});
  // 未知尝试保留预留：malformed usage 不结算，缺 id 的结算不动账。
  settleDesignRequest(budget, "ghost", 100);
  assert.equal(budget.chargedMicroUsd, 47_875);
  assert.equal(designUsageMicroUsd({ input_tokens: "x", output_tokens: 1 }, PRICES), null);
  assert.equal(designUsageMicroUsd({ input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_creation: { ephemeral_1h_input_tokens: 2 } }, PRICES), null);
});

function store(initial?: DesignBudget): { store: DesignBudgetStore; budget: () => DesignBudget } {
  const budget = initial ?? emptyDesignBudget();
  return {
    budget: () => budget,
    store: {
      change: (update) => Promise.resolve(update(budget)),
      active: async () => true,
    },
  };
}

const MODEL = "claude-opus-5-5";
const body = (maxTokens = 4096) => JSON.stringify({ model: MODEL, stream: true, max_tokens: maxTokens, messages: [{ role: "user", content: "hi" }] });
const countTokens = (input: number) => Response.json({ input_tokens: input });
const sse = (chunks: string[]) => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
}), { status: 200 });

const usageEvent = (usage: Record<string, unknown>) => `data: ${JSON.stringify({ type: "message_delta", usage })}\n\n`;
const startEvent = `data: ${JSON.stringify({ type: "message_start", message: { model: MODEL, usage: { input_tokens: 100, output_tokens: 1 } } })}\n\n`;

function budgeted(budgetStore: DesignBudgetStore, fetcher: typeof fetch) {
  return designBudgetFetch({ fetcher, store: budgetStore, model: MODEL, prices: PRICES, limitCents: CENTS });
}

test("预留放不下时标 denied 且不发上游 /messages：chargedMicroUsd 低于上限也按超支判，denied 是终态", async () => {
  const { store: budgetStore, budget } = store({ chargedMicroUsd: 202_400, requests: 1, reservations: { r1: 202_400 } });
  const upstream: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    upstream.push(url);
    return url.endsWith("/v1/messages/count_tokens") ? countTokens(1_000) : sse([startEvent, usageEvent({ input_tokens: 100, output_tokens: 10 })]);
  }) as typeof fetch;
  const guarded = budgeted(budgetStore, fetcher);
  await assert.rejects(guarded("https://api.anthropic.com/v1/messages", { method: "POST", body: body() }), /used its budget/);
  assert.equal(budget().denied, true);
  assert.ok(!upstream.some((url) => url.endsWith("/v1/messages") && !url.includes("count_tokens")));
  // denied 之后连 output 为 1 的小预留也进不来：标位本身终态，不再看 chargedMicroUsd 的余量；count_tokens 不算付费。
  upstream.length = 0;
  await assert.rejects(guarded("https://api.anthropic.com/v1/messages", { method: "POST", body: body(1) }), /used its budget/);
  assert.equal(reserveDesignRequest(budget(), "r9", 1, 1, PRICES, CENTS), false);
  assert.ok(!upstream.some((url) => url.endsWith("/v1/messages") && !url.includes("count_tokens")));
});

test("SSE 缺 message_stop 或残缺时预留保留；按帧拆碎的 CRLF 事件照常结算", async () => {
  const incomplete = store();
  const fetch1 = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("count_tokens") ? countTokens(1_000) : sse([startEvent, "data: {\"type\":\"message_delta\""]);
  }) as typeof fetch;
  const response1 = await budgeted(incomplete.store, fetch1)("https://api.anthropic.com/v1/messages", { method: "POST", body: body() });
  await response1.text();
  assert.equal(Object.keys(incomplete.budget().reservations).length, 1);
  assert.equal(incomplete.budget().requests, 1);

  const fragmented = store();
  const frames = [startEvent, usageEvent({ input_tokens: 100, output_tokens: 10 }), `data: ${JSON.stringify({ type: "message_stop" })}\n\n`].join("").replaceAll("\n", "\r\n");
  const halves = [frames.slice(0, 37), frames.slice(37, 91), frames.slice(91)];
  const fetch2 = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("count_tokens") ? countTokens(1_000) : sse(halves);
  }) as typeof fetch;
  const response2 = await budgeted(fragmented.store, fetch2)("https://api.anthropic.com/v1/messages", { method: "POST", body: body() });
  await response2.text();
  assert.deepEqual(fragmented.budget().reservations, {});
  // usage{input100,output10} = 500 + 250 = 750 microUSD。
  assert.equal(fragmented.budget().chargedMicroUsd, 750);
});

test("已知不可计费的 4xx 结清预留；别的上游状态保留预留", async () => {
  const released = store();
  const fetch1 = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("count_tokens") ? countTokens(1_000) : new Response("bad", { status: 400 });
  }) as typeof fetch;
  const response1 = await budgeted(released.store, fetch1)("https://api.anthropic.com/v1/messages", { method: "POST", body: body() });
  await response1.text();
  assert.equal(released.budget().chargedMicroUsd, 0);
  assert.deepEqual(released.budget().reservations, {});

  const kept = store();
  const fetch2 = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.endsWith("count_tokens") ? countTokens(1_000) : new Response("bad", { status: 500 });
  }) as typeof fetch;
  const response2 = await budgeted(kept.store, fetch2)("https://api.anthropic.com/v1/messages", { method: "POST", body: body() });
  await response2.text();
  assert.equal(Object.keys(kept.budget().reservations).length, 1);
});

test("非 /v1/messages 请求、错模型与非流式负载在进入额度流程前就拒掉", async () => {
  const { store: budgetStore } = store();
  const guarded = budgeted(budgetStore, async () => { throw new Error("must not fetch"); });
  await assert.rejects(guarded("https://api.anthropic.com/v1/other", { method: "POST", body: body() }), /Unsupported/);
  await assert.rejects(guarded("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "other", stream: true, max_tokens: 10 }) }), /Invalid planner model request/);
  await assert.rejects(guarded("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: MODEL, stream: false, max_tokens: 10 }) }), /Invalid planner model request/);
});
