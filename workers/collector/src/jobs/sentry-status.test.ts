import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";
import type { SentryStatusPayload } from "@shared/sentry-status-types";

import type { Env } from "../env";
import { MemoryKv } from "../testing/memory-kv";
import { sentryStatusJob } from "./sentry-status";

const now = 1_700_000_000_000;
const env = (lag: MemoryKv) => ({ LAG: lag.asKv(), SENTRY_API_TOKEN: "sntry-token" }) as unknown as Env;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

test("缺 Sentry 令牌干净跳过", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await sentryStatusJob.run({ env: {} as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing SENTRY_API_TOKEN",
  });
  assert.deepEqual(await sentryStatusJob.run({ env: { SENTRY_API_TOKEN: "  " } as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing SENTRY_API_TOKEN",
  });
});

test("Sentry 全部查询失败整轮抛错，不拿空壳覆盖上一份", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  t.mock.method(globalThis, "fetch", async () => new Response("down", { status: 500 }));
  await assert.rejects(sentryStatusJob.run({ env: env(lag), now, scheduled: true }), /全部查询失败/);
  assert.equal(lag.puts.length, 0);
});

test("只有 cron 监控查不到时那一块沿用上一份，detail 点名缺的是它", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path.includes("/monitors/")) return new Response("down", { status: 500 });
    if (path.endsWith("/uptime-stats/")) return json({ [url.searchParams.get("uptimeDetectorId") ?? ""]: [] });
    if (path.includes("/uptime/")) return json({ uptimeStatus: 1, url: "https://lyjw.me", intervalSeconds: 120 });
    if (path.endsWith("/issues-count/")) return json({ "is:unresolved": 4 });
    if (path.endsWith("/events/")) return json({ data: [{ "count()": 7, "p75(measurements.lcp)": 2100 }] });
    return new Response("unexpected", { status: 500 });
  });

  assert.deepEqual(await sentryStatusJob.run({ env: env(lag), now, scheduled: true }), {
    status: "ok",
    detail: "heartbeat carried over",
  });
  const entry = await readLag<SentryStatusPayload>(lag, LAG_KEYS.sentry);
  assert.equal(entry?.data.uptime?.status, "up");
  assert.equal(entry?.data.heartbeat, null);
  assert.equal(entry?.data.errors?.site.count12h, 7);
  assert.equal(entry?.data.errors?.worker.unresolved, 4);
  assert.equal(entry?.data.vitals?.lcpP75Ms, 2100);
  assert.equal(entry?.updatedAt, entry?.data.fetchedAt);
});
