import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";
import { HEALTH_DAYS, HEALTH_RETENTION_MS, HEARTBEAT_SERIES, UPTIME_SERIES, pruneChecks, readBuckets, recordCheck, summarizeBuckets } from "@shared/health";
import type { HealthPayload } from "@shared/health-types";

import { MemoryKv } from "../testing/memory-kv";
import { historyDb } from "../testing/sqlite-history";
import type { Env } from "../env";
import { siteHealthJob } from "./site-health";
import { probeSite, uptimeProbeJob } from "./uptime-probe";

const now = 1_700_000_000_000;

const HEALTH_SITES = JSON.stringify({ "lyjw.me": "a".repeat(32), "lyjw131.com": "b".repeat(32) });

function cloudflareHealthFetch(options: { vitalsDown?: boolean; inFlight?: { now: number; peak: number } } = {}) {
  return async (url: string | URL, init?: RequestInit) => {
    const flight = options.inFlight;
    if (flight) flight.peak = Math.max(flight.peak, ++flight.now);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await answer(url, init);
    } finally {
      if (flight) flight.now--;
    }
  };
  async function answer(url: string | URL, init?: RequestInit) {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/graphql")) {
      if (options.vitalsDown) return new Response("down", { status: 503 });
      return Response.json({ data: { viewer: { accounts: [{ vitals: [{ count: 44, quantiles: {
        largestContentfulPaintP75: 609_000, interactionToNextPaintP75: 48_000, cumulativeLayoutShiftP75: 0.001,
        firstContentfulPaintP75: 588_000, timeToFirstByteP75: 0,
      } }] }] } } });
    }
    if (path.endsWith("/issues/summary")) {
      const service = new URL(String(url)).searchParams.get("service");
      return Response.json({ success: true, result: { activeIssues: service === "core" ? 2 : 0, activeOccurrences: 0, lastIssue: null, resolvedIssues: 0 } });
    }
    const body = JSON.parse(String(init?.body)) as { timeframe: { from: number; to: number } };
    const week = body.timeframe.to - body.timeframe.from > 86_400_000;
    const group = (service: string, count: number) => ({ groups: [{ key: "$metadata.service", value: service }], count });
    return Response.json({ success: true, result: { calculations: [{ aggregates: [
      group("site", week ? 30 : 3), group("core", week ? 10 : 1), group("collector", week ? 5 : 0), group("other-worker", 99),
    ] }] } });
  }
}

test("uptime probe records scheduled runs only, and a failed fetch counts as down", async (t) => {
  const { db, all } = historyDb();
  const env = { HISTORY: db } as unknown as Env;
  t.mock.method(globalThis, "fetch", async () => new Response("ok"));
  assert.deepEqual(await uptimeProbeJob.run({ env, now, scheduled: true }), { status: "ok" });
  await uptimeProbeJob.run({ env, now: now + 60_000, scheduled: false });
  assert.deepEqual(all("SELECT series, success, failure FROM health_buckets"), [{ series: "site-uptime", success: 1, failure: 0 }]);
  assert.equal(await probeSite(async () => { throw new TypeError("network"); }), false);
  assert.equal(await probeSite(async () => new Response("", { status: 502 })), false);
});

test("site health summarizes D1 checks with Cloudflare errors and vitals, carrying a failed block", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { db, all } = historyDb();
  const lag = new MemoryKv();
  const env = { HISTORY: db, LAG: lag, CLOUDFLARE_METRICS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", SITE_ANALYTICS_SITES: HEALTH_SITES } as unknown as Env;
  await recordCheck(db, HEARTBEAT_SERIES, now - 3 * 60_000, true);
  await recordCheck(db, UPTIME_SERIES, now - 60_000, false);
  await recordCheck(db, UPTIME_SERIES, now - 40 * 86_400_000, true);
  await recordCheck(db, UPTIME_SERIES, now - 41 * 86_400_000, true);
  const inFlight = { now: 0, peak: 0 };
  const fetches = t.mock.method(globalThis, "fetch", cloudflareHealthFetch({ inFlight }));

  assert.deepEqual(await siteHealthJob.run({ env, now, scheduled: true }), { status: "ok" });
  assert.ok(inFlight.peak <= 4, `同时在等的 Cloudflare 请求 ${inFlight.peak} 个，collector 一次调用最多 6 个`);
  const first = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.equal(first.heartbeat?.status, "up");
  assert.equal(first.uptime?.status, "down");
  assert.equal(first.uptime?.intervalSeconds, 60);
  assert.deepEqual(first.errors, { site: { count12h: 3, count7d: 30, unresolved: 0 }, worker: { count12h: 1, count7d: 15, unresolved: 2 } });
  assert.deepEqual(first.vitals, { lcpP75Ms: 609, inpP75Ms: 48, clsP75: 0.001, fcpP75Ms: 588, ttfbP75Ms: null, samples: 44 });
  assert.equal(all("SELECT COUNT(*) AS n FROM health_buckets")[0].n, 3, "保留期外的格子清掉，每个序列只留最新的一格");

  fetches.mock.mockImplementation(cloudflareHealthFetch({ vitalsDown: true }));
  assert.deepEqual(await siteHealthJob.run({ env, now: now + 300_000, scheduled: true }), { status: "ok", detail: "vitals carried over" });
  const second = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.deepEqual(second.vitals, first.vitals);
  assert.equal(second.blockAt?.vitals, now);
});

test("health buckets come back with the last hour before the window, when one is kept", async () => {
  const { db } = historyDb();
  const day = 86_400_000;
  const windowStart = Math.floor(now / day) * day - (HEALTH_DAYS - 1) * day;
  await recordCheck(db, HEARTBEAT_SERIES, windowStart - 5 * 3_600_000, true);
  await recordCheck(db, HEARTBEAT_SERIES, windowStart - 2 * 3_600_000, true);
  await recordCheck(db, HEARTBEAT_SERIES, windowStart + 3 * 3_600_000, true);
  await recordCheck(db, UPTIME_SERIES, windowStart + 3 * 3_600_000, true);
  assert.deepEqual((await readBuckets(db, HEARTBEAT_SERIES, now)).map((b) => b.hourStart), [windowStart - 2 * 3_600_000, windowStart + 3 * 3_600_000]);
  assert.deepEqual((await readBuckets(db, UPTIME_SERIES, now)).map((b) => b.hourStart), [windowStart + 3 * 3_600_000]);
});

test("an outage longer than retention keeps each series' newest expired hour, so the heartbeat still reads down", async () => {
  const { db } = historyDb();
  const hour = 3_600_000;
  const hourOf = (at: number) => Math.floor(at / hour) * hour;
  const cut = now - HEALTH_RETENTION_MS;
  await recordCheck(db, HEARTBEAT_SERIES, cut - 30 * hour, true);
  await recordCheck(db, HEARTBEAT_SERIES, cut - 10 * hour, true);
  await recordCheck(db, UPTIME_SERIES, cut - 20 * hour, true);
  await pruneChecks(db, now);
  await pruneChecks(db, now);
  const heartbeat = await readBuckets(db, HEARTBEAT_SERIES, now);
  assert.deepEqual(heartbeat.map((b) => b.hourStart), [hourOf(cut - 10 * hour)]);
  assert.deepEqual((await readBuckets(db, UPTIME_SERIES, now)).map((b) => b.hourStart), [hourOf(cut - 20 * hour)]);
  const summary = summarizeBuckets(HEARTBEAT_SERIES, heartbeat, now);
  assert.equal(summary.status, "down");
  assert.equal(summary.availability30d, 0);
});

test("site health without Cloudflare settings still refreshes the D1 uptime rows", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { db } = historyDb();
  const lag = new MemoryKv();
  const env = { HISTORY: db, LAG: lag } as unknown as Env;
  await recordCheck(db, UPTIME_SERIES, now - 60_000, true);
  const fetches = t.mock.method(globalThis, "fetch", cloudflareHealthFetch());
  assert.deepEqual(await siteHealthJob.run({ env, now, scheduled: true }), {
    status: "ok",
    detail: "missing CLOUDFLARE_METRICS_TOKEN, CLOUDFLARE_ACCOUNT_ID, SITE_ANALYTICS_SITES",
  });
  const data = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.equal(data.uptime?.status, "up");
  assert.equal(data.errors, null);
  assert.equal(data.vitals, null);
  assert.equal(fetches.mock.callCount(), 0);
});

test("site health with a malformed site list only carries over Web Vitals", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { db } = historyDb();
  const lag = new MemoryKv();
  const env = { HISTORY: db, LAG: lag, CLOUDFLARE_METRICS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", SITE_ANALYTICS_SITES: "not json" } as unknown as Env;
  await recordCheck(db, UPTIME_SERIES, now - 60_000, true);
  t.mock.method(globalThis, "fetch", cloudflareHealthFetch());
  assert.deepEqual(await siteHealthJob.run({ env, now, scheduled: true }), { status: "ok", detail: "vitals carried over" });
  const data = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.equal(data.uptime?.status, "up");
  assert.notEqual(data.errors, null);
  assert.equal(data.vitals, null);
});
