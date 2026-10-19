import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";

import { MemoryKv } from "../testing/memory-kv";
import type { Env } from "../env";
import { appleRecentJob } from "./apple-recent";
import { siteAnalyticsJob, siteDeploymentsJob } from "./site-status";

const noEnv = {} as Env;
const now = 1_700_000_000_000;

test("apple-recent 缺签 developer token 或真名打码的配置时干净跳过，不去读凭据", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await appleRecentJob.run({ env: { APPLE_MUSIC_TEAM_ID: "TEAM000000" } as Env, now, scheduled: false }), {
    status: "skipped",
    detail: "missing APPLE_MUSIC_PRIVATE_KEY, APPLE_MUSIC_KEY_ID, APPLE_MUSIC_OWNER_NAME",
  });
  const signed = { APPLE_MUSIC_TEAM_ID: "TEAM000000", APPLE_MUSIC_KEY_ID: "KEY0000000", APPLE_MUSIC_PRIVATE_KEY: "p8" } as Env;
  assert.deepEqual(await appleRecentJob.run({ env: signed, now, scheduled: false }), {
    status: "skipped",
    detail: "missing APPLE_MUSIC_OWNER_NAME",
  });
});

test("site-deployments 缺配置干净跳过，缺哪个报哪个", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await siteDeploymentsJob.run({ env: noEnv, now, scheduled: false }), {
    status: "skipped",
    detail: "missing CLOUDFLARE_METRICS_TOKEN, CLOUDFLARE_ACCOUNT_ID, SITE_WORKER_TAG",
  });
  const partial = {
    CLOUDFLARE_METRICS_TOKEN: "t",
    CLOUDFLARE_ACCOUNT_ID: "a",
  } as Env;
  assert.deepEqual(await siteDeploymentsJob.run({ env: partial, now, scheduled: false }), {
    status: "skipped",
    detail: "missing SITE_WORKER_TAG",
  });
});

test("site-deployments 成功才写 LAG，失败那轮不覆盖上一份", async (t) => {
  const lag = new MemoryKv();
  const env = {
    LAG: lag,
    CLOUDFLARE_METRICS_TOKEN: "t",
    CLOUDFLARE_ACCOUNT_ID: "a",
    SITE_WORKER_TAG: "c".repeat(32),
  } as unknown as Env;
  let failing = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    if (failing) return new Response("down", { status: 503 });
    if (String(url).includes("/site/deployments")) return Response.json({ success: true, result: { deployments: [] } });
    return Response.json({ success: true, result: [] });
  });

  assert.deepEqual(await siteDeploymentsJob.run({ env, now, scheduled: true }), { status: "ok" });
  const first = await readLag(lag, LAG_KEYS.siteDeployments);
  assert.equal(first?.updatedAt, now);

  failing = true;
  await assert.rejects(siteDeploymentsJob.run({ env, now: now + 60_000, scheduled: true }), /503/);
  assert.deepEqual(await readLag(lag, LAG_KEYS.siteDeployments), first);
});

test("site-analytics 缺配置或站点映射不全时跳过", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await siteAnalyticsJob.run({ env: noEnv, now, scheduled: false }), {
    status: "skipped",
    detail: "missing CLOUDFLARE_METRICS_TOKEN, CLOUDFLARE_ACCOUNT_ID, SITE_ANALYTICS_SITES",
  });
  const partial = {
    CLOUDFLARE_METRICS_TOKEN: "t",
    CLOUDFLARE_ACCOUNT_ID: "a",
    SITE_ANALYTICS_SITES: JSON.stringify({ "lyjw.me": "a".repeat(32) }),
  } as Env;
  await assert.rejects(
    siteAnalyticsJob.run({ env: partial, now, scheduled: false }),
    /both production hosts/,
  );
});
