import assert from "node:assert/strict";
import { test } from "node:test";
import { put } from "./cache.ts";
import { getServiceTrends } from "./service-trends.ts";

const vercelCreds = (tag: string) => ({ project: `p-${tag}`, team: `t-${tag}`, token: "v-secret" });
const cfCreds = (tag: string) => ({ account: `a-${tag}`, token: "c-secret" });
const trendsKey = (tag: string) => `service-trends:v1:t-${tag}:p-${tag}:a-${tag}`;

const vercelOk = () => Response.json({
  summary: [{ total: 10, errors: 1, timeouts: 0, cpuP75Ms: 5, memoryAvgMb: 100 }],
  data: [{ timestamp: "2026-09-12T00:00:00Z", total: 4 }],
});
const cfOk = () => Response.json({ data: { viewer: { accounts: [{ summary: [], series: [] }] } }, errors: null });
const denied = () => Response.json({ error: "forbidden" }, { status: 403 });

test("both sides share one window from a single refresh", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://vercel.com/")) return vercelOk();
    if (url.startsWith("https://api.cloudflare.com/")) return cfOk();
    throw new Error(`unexpected host: ${url}`);
  });
  const result = await getServiceTrends(vercelCreds("same"), cfCreds("same"));
  assert.ok(result.vercel && result.workers);
  assert.equal(result.vercel.windowStart, result.workers.windowStart);
  assert.equal(result.vercel.windowEnd, result.workers.windowEnd);
  assert.equal(result.vercel.fetchedAt, result.workers.fetchedAt);
  assert.equal(result.vercel.windowEnd - result.vercel.windowStart, 12 * 3_600_000);
  assert.equal(result.vercel.windowEnd % 900_000, 0);
  assert.equal(result.vercel.data.invocations, 10);
  assert.doesNotMatch(JSON.stringify(result), /v-secret|c-secret/);
});

test("single-side failure keeps the other side fresh and backfills from last-good", async (t) => {
  const oldStart = Date.parse("2026-09-11T00:00:00Z"), oldEnd = oldStart + 12 * 3_600_000;
  const workersPrev = {
    data: { fetchedAt: oldEnd, windowStart: oldStart, windowEnd: oldEnd, workers: [] },
    windowStart: oldStart, windowEnd: oldEnd, fetchedAt: oldEnd,
  };
  await put(`${trendsKey("partial")}:last-good`, { vercel: null, workers: workersPrev }, 86_400_000);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://vercel.com/")) return vercelOk();
    return denied();
  });
  const result = await getServiceTrends(vercelCreds("partial"), cfCreds("partial"));
  assert.ok(result.vercel && result.workers);
  assert.notEqual(result.vercel.windowEnd, oldEnd);
  assert.deepEqual(result.workers, workersPrev);
});

test("total failure without last-good throws after a short negative hold", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return denied(); });
  await assert.rejects(getServiceTrends(vercelCreds("fail"), cfCreds("fail")), /服务趋势暂不可用/);
  // 两边各打一次；紧接着再问直接短路，不再出网。
  assert.equal(calls, 2);
  await assert.rejects(getServiceTrends(vercelCreds("fail"), cfCreds("fail")), /服务趋势暂不可用/);
  assert.equal(calls, 2);
});

test("missing side is skipped without failing the available side", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return vercelOk(); });
  const result = await getServiceTrends(vercelCreds("half"), null);
  assert.ok(result.vercel);
  assert.equal(result.workers, null);
  assert.equal(calls, 1);
});
