import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import type { AgentStatusPayload, AgentStatusRow } from "@/lib/agent-status-types";
import type { WorkerDeploymentAttempt } from "@/lib/cloudflare-workers";
import type { CloudflareDeploymentsPayload, WorkerDeployment } from "@/lib/cloudflare-workers-types";
import { PAGESPEED_TIMEOUT_MS } from "@/lib/pagespeed";
import { mergeSentryStatus, SENTRY_BLOCK_CARRY_MS } from "@/lib/sentry-status";
import type { SentryStatusPayload } from "@/lib/sentry-status-types";
import type { GithubRepoPayload } from "@/lib/types";
import type { VercelMetricsPayload } from "@/lib/vercel-deployments-types";

import { MemoryKv } from "../testing/memory-kv";
import { refreshCloudflareDeployments } from "./cloudflare";
import { mergeRepoStats } from "./github-repo";
import { pagespeedJob } from "./pagespeed";
import { refreshProviderStatus } from "./provider-status";
import { refreshVercelMetrics } from "./vercel";

function row(id: AgentStatusRow["id"], indicator: AgentStatusRow["indicator"]): AgentStatusRow {
  return { id, name: id, indicator, statusUrl: `https://status.example/${id}`, components: [], incidents: [], note: null, stale: false } as AgentStatusRow;
}

function statusPayload(fetchedAt: number, indicator: AgentStatusRow["indicator"]): AgentStatusPayload {
  return { fetchedAt, agents: [row("claude", indicator), row("github", "operational")] };
}

test("provider status writes every round, revalidates only when the lights change", async () => {
  const lag = new MemoryKv();
  const revalidated: string[][] = [];
  const core = { revalidate: async (tags: string[]) => { revalidated.push(tags); } };
  const seen: (AgentStatusPayload | null)[] = [];
  const memo = {};
  let indicator: AgentStatusRow["indicator"] = "operational";
  const collect = async (previous: AgentStatusPayload | null, now: number) => {
    seen.push(previous);
    return statusPayload(now, indicator);
  };

  assert.deepEqual(await refreshProviderStatus({ lag, core, collect, memo }, 1_000), { status: "ok", detail: "changed" });
  assert.deepEqual(revalidated, [["agent-status"]]);
  assert.equal(seen[0], null);

  assert.deepEqual(await refreshProviderStatus({ lag, core, collect, memo }, 61_000), { status: "ok" });
  assert.equal(revalidated.length, 1);
  assert.equal(seen[1]?.fetchedAt, 1_000, "上一轮取自可滞后层");
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 61_000);

  indicator = "major_outage";
  await refreshProviderStatus({ lag, core, collect, memo }, 121_000);
  assert.equal(revalidated.length, 2);
});

test("provider status prefers its own newer write over a lagging KV read", async () => {
  const lag = new MemoryKv();
  const core = { revalidate: async () => {} };
  const memo = {};
  const seen: (AgentStatusPayload | null)[] = [];
  const collect = async (previous: AgentStatusPayload | null, now: number) => {
    seen.push(previous);
    return statusPayload(now, "operational");
  };
  await refreshProviderStatus({ lag, core, collect, memo }, 1_000);
  await writeLag(lag, LAG_KEYS.agentStatus, statusPayload(500, "major_outage"), 500);
  await refreshProviderStatus({ lag, core, collect, memo }, 61_000);
  assert.equal(seen[1]?.fetchedAt, 1_000);
});

test("a failed revalidation does not fail the round; a failed collection does not overwrite", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  const core = { revalidate: async () => { throw new Error("core down"); } };
  const memo = {};
  const result = await refreshProviderStatus({ lag, core, memo, collect: async (_, now) => statusPayload(now, "operational") }, 5_000);
  assert.equal(result.detail, "changed");
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 5_000);

  await assert.rejects(refreshProviderStatus({ lag, core, memo, collect: async () => { throw new Error("boom"); } }, 9_000));
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 5_000);
});

const repo = (commits: number | null, contributors = 2, fetchedAt = 1): GithubRepoPayload => ({
  repo: "LYJW131/lyjwpage",
  fetchedAt,
  totals: { commits, additions: commits == null ? null : commits * 10, deletions: commits == null ? null : commits, contributors },
  contributors: Array.from({ length: contributors }, (_, index) => ({ login: `p${index}`, avatarUrl: null, commits: 1, additions: 1, deletions: 0 })),
});

test("repo stats keep the good half of a partial round", () => {
  const previous = repo(400, 3, 1);
  assert.deepEqual(mergeRepoStats({ ok: true, data: repo(434, 2, 2) }, previous), { ...repo(434, 2, 2), totalsAt: 2 });
  const totalsMissing = mergeRepoStats({ ok: true, data: repo(null, 2, 2) }, previous);
  assert.deepEqual(totalsMissing?.totals, { commits: 400, additions: 4000, deletions: 400, contributors: 2 });
  assert.equal(totalsMissing?.contributors.length, 2);
  assert.equal(totalsMissing?.totalsAt, 1);
  assert.equal(mergeRepoStats({ ok: true, data: repo(null, 2, 3) }, totalsMissing)?.totalsAt, 1);
  const contributorsMissing = mergeRepoStats({ ok: false, totals: { commits: 434, additions: 4340, deletions: 434 } }, previous, 5);
  assert.deepEqual(contributorsMissing?.totals, { commits: 434, additions: 4340, deletions: 434, contributors: 3 });
  assert.equal(contributorsMissing?.fetchedAt, 1);
  assert.equal(contributorsMissing?.totalsAt, 5);
  assert.equal(mergeRepoStats({ ok: false, totals: { commits: null, additions: null, deletions: null } }, previous), null);
  assert.equal(mergeRepoStats({ ok: false, totals: { commits: 434, additions: 1, deletions: 1 } }, null), null);
});

test("vercel metrics carry a failed group over with its own collected-at", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  const functions = { fetchedAt: 10, start: 0, end: 10, invocations: 5, errors: 0, timeouts: 0, cpuP75Ms: 3, memoryAvgMb: 100 };
  const analytics = { fetchedAt: 10, start: 0, end: 10, pageviews: 50, visitors: 9 };
  await refreshVercelMetrics(lag, { functions: async () => functions, analytics: async () => analytics }, 10);

  const { payload, failed } = await refreshVercelMetrics(lag, {
    functions: async () => ({ ...functions, fetchedAt: 20, invocations: 7 }),
    analytics: async () => { throw new Error("503"); },
  }, 20);
  assert.deepEqual(failed, ["analytics"]);
  assert.equal(payload.functions?.invocations, 7);
  assert.deepEqual(payload.analytics, analytics);
  assert.equal((await readLag<VercelMetricsPayload>(lag, LAG_KEYS.vercelMetrics))?.updatedAt, 20);

  await assert.rejects(refreshVercelMetrics(lag, {
    functions: async () => { throw new Error("503"); },
    analytics: async () => { throw new Error("503"); },
  }, 30));
  assert.equal((await readLag<VercelMetricsPayload>(lag, LAG_KEYS.vercelMetrics))?.updatedAt, 20);
});

test("sentry status carries a failed block with its own time, and only for a while", async () => {
  const lag = new MemoryKv();
  const errors = { site: { count12h: 1, count7d: 2, unresolved: 0 }, worker: { count12h: 3, count7d: 4, unresolved: 1 } };
  const previous: SentryStatusPayload = { fetchedAt: 1, uptime: null, heartbeat: null, errors, vitals: null };
  await writeLag(lag, LAG_KEYS.sentry, previous, 1);
  const vitals = { lcpP75Ms: 1800, inpP75Ms: null, clsP75: null, fcpP75Ms: null, ttfbP75Ms: null, samples: 3 };
  const merged = mergeSentryStatus({ fetchedAt: 2, uptime: null, heartbeat: null, errors: null, vitals }, previous);
  assert.deepEqual(merged, { fetchedAt: 2, uptime: null, heartbeat: null, errors, vitals, blockAt: { errors: 1, vitals: 2 } });

  const later = mergeSentryStatus({ fetchedAt: SENTRY_BLOCK_CARRY_MS - 1, uptime: null, heartbeat: null, errors: null, vitals }, merged);
  assert.equal(later.blockAt?.errors, 1);
  assert.deepEqual(later.errors, errors);
  const expired = mergeSentryStatus({ fetchedAt: SENTRY_BLOCK_CARRY_MS + 1, uptime: null, heartbeat: null, errors: null, vitals }, later);
  assert.equal(expired.errors, null);
  assert.equal(expired.blockAt?.errors, undefined);
});

test("pagespeed waits per request for less than the job's runtime budget", () => {
  assert.ok(PAGESPEED_TIMEOUT_MS < pagespeedJob.maxRuntimeMinutes * 60_000);
});

const workerDeployment = (deployedAt: number): WorkerDeployment => ({
  deployedAt, versions: [{ id: "v1", percentage: 100 }], commit: null,
});

test("a failed worker deployment keeps the last confirmed copy and its time", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  const previous: CloudflareDeploymentsPayload = {
    fetchedAt: 10,
    workers: [
      { name: "api", deployment: workerDeployment(1), observedAt: 10 },
      { name: "ingress", deployment: null, observedAt: 10 },
      { name: "collector", deployment: workerDeployment(2), observedAt: 10 },
    ],
  };
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, previous, 10);
  const attempts: WorkerDeploymentAttempt[] = [
    { name: "api", ok: false, error: "Cloudflare 查询失败 (500)" },
    { name: "ingress", ok: true, deployment: null },
    { name: "collector", ok: true, deployment: workerDeployment(3) },
  ];
  const result = await refreshCloudflareDeployments(lag, async () => attempts, 20);
  assert.equal(result.detail, "api carried over");
  const stored = (await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.data;
  assert.equal(stored?.fetchedAt, 20);
  assert.equal(stored?.workers[0]?.deployment?.deployedAt, 1);
  assert.equal(stored?.workers[0]?.observedAt, 10, "失败的格子不刷新确认时刻");
  assert.equal(stored?.workers[1]?.deployment, null);
  assert.equal(stored?.workers[1]?.observedAt, 20, "空列表是确认过的没有部署");
  assert.equal(stored?.workers[2]?.deployment?.deployedAt, 3);
  assert.equal(stored?.workers[2]?.observedAt, 20);

  await assert.rejects(refreshCloudflareDeployments(lag, async () => attempts.map((attempt) => (
    attempt.ok ? { name: attempt.name, ok: false as const, error: "down" } : attempt
  )), 30), /一个都没取到/);
  assert.equal((await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.updatedAt, 20);
});

test("a failed deployment with nothing saved is not a fresh empty cell", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  const attempts: WorkerDeploymentAttempt[] = [
    { name: "api", ok: false, error: "Cloudflare 查询失败 (500)" },
    { name: "ingress", ok: true, deployment: workerDeployment(4) },
    { name: "collector", ok: true, deployment: workerDeployment(5) },
  ];
  await refreshCloudflareDeployments(lag, async () => attempts, 20);
  const stored = (await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.data;
  assert.equal(stored?.workers[0]?.deployment, null);
  assert.equal(stored?.workers[0]?.observedAt, 0);
});
