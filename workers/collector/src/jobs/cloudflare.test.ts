import assert from "node:assert/strict";
import test from "node:test";

import { LAG_KEYS, readLag } from "@shared/lag";
import { CLOUDFLARE_WORKERS, type CloudflareDeploymentsPayload, type CloudflareMetricsPayload } from "@shared/cloudflare-workers-types";

import type { Env } from "../env";
import { MemoryKv } from "../testing/memory-kv";
import { cloudflareDeploymentsJob, cloudflareMetricsJob } from "./cloudflare";

const now = 1_700_000_000_000;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const configured = (lag: MemoryKv) =>
  ({ LAG: lag.asKv(), CLOUDFLARE_METRICS_TOKEN: "metrics-token", CLOUDFLARE_ACCOUNT_ID: "account-1" }) as unknown as Env;

test("两个任务缺令牌或账号都干净跳过，缺哪个报哪个", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await cloudflareDeploymentsJob.run({ env: {} as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing CLOUDFLARE_METRICS_TOKEN, CLOUDFLARE_ACCOUNT_ID",
  });
  assert.deepEqual(await cloudflareMetricsJob.run({ env: { CLOUDFLARE_ACCOUNT_ID: "a" } as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing CLOUDFLARE_METRICS_TOKEN",
  });
});

test("一个 Worker 的部署没取到只留它自己为 null；一个都没取到整轮抛错、不写旧值", async (t) => {
  const lag = new MemoryKv();
  const env = configured(lag);
  const down = new Set(["collector"]);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const name = url.pathname.split("/").at(-2) ?? "";
    if (url.pathname.endsWith("/deployments")) {
      if (down.has(name)) return new Response("down", { status: 503 });
      return json({ success: true, result: { deployments: [{ created_on: "2026-10-13T01:02:03Z", versions: [{ version_id: `v-${name}`, percentage: 100 }] }] } });
    }
    if (url.pathname.includes("/versions")) return json({ success: true, result: { items: [] } });
    if (url.pathname.includes("/builds/builds")) return json({ success: true, result: { builds: {} } });
    return new Response("unexpected", { status: 500 });
  });

  assert.deepEqual(await cloudflareDeploymentsJob.run({ env, now, scheduled: true }), { status: "ok" });
  const entry = await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments);
  assert.equal(entry?.data.workers.length, CLOUDFLARE_WORKERS.length);
  const byName = new Map(entry?.data.workers.map((worker) => [worker.name, worker.deployment]));
  assert.equal(byName.get("site")?.deployedAt, Date.parse("2026-10-13T01:02:03Z"));
  assert.deepEqual(byName.get("site")?.versions, [{ id: "v-site", percentage: 100 }]);
  assert.equal(byName.get("collector"), null);
  assert.equal(entry?.updatedAt, entry?.data.fetchedAt);

  down.add("site");
  down.add("core");
  down.add("ingress");
  await assert.rejects(cloudflareDeploymentsJob.run({ env, now: now + 60_000, scheduled: true }), /一个都没取到/);
  assert.equal((await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.updatedAt, entry?.updatedAt, "失败那轮不覆盖上一份");
});

test("指标窗口结束在最近的 15 分钟边界、长 12 小时，取回的 P50 换成毫秒", async (t) => {
  const lag = new MemoryKv();
  const env = configured(lag);
  let variables: { account?: string; start?: string; end?: string } | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/client/v4/graphql");
    variables = JSON.parse(String(init?.body)).variables;
    return json({
      data: {
        viewer: {
          accounts: [{
            summary: [{ dimensions: { scriptName: "site" }, sum: { requests: 5, errors: 1, subrequests: 9 }, quantiles: { cpuTimeP50: 800 } }],
          }],
        },
      },
    });
  });

  const before = Date.now();
  assert.deepEqual(await cloudflareMetricsJob.run({ env, now, scheduled: true }), { status: "ok" });
  const end = Date.parse(variables?.end ?? "");
  assert.equal(end % (15 * 60_000), 0, "窗口右端对齐 15 分钟边界");
  assert.ok(end <= before && end > before - 15 * 60_000, "结束在这一响之前的最近一个边界上");
  assert.equal(end - Date.parse(variables?.start ?? ""), 12 * 3_600_000);
  assert.equal(variables?.account, "account-1");

  const entry = await readLag<CloudflareMetricsPayload>(lag, LAG_KEYS.cloudflareMetrics);
  assert.equal(entry?.data.windowEnd, end);
  assert.deepEqual(entry?.data.workers.find((worker) => worker.name === "site")?.metrics, {
    requests: 5, errors: 1, subrequests: 9, cpuTimeP50Ms: 0.8,
  });
  assert.equal(entry?.data.workers.find((worker) => worker.name === "ingress")?.metrics, null);
  assert.equal(entry?.updatedAt, entry?.data.fetchedAt);
});
