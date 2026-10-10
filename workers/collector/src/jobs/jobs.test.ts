import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import type { AgentStatusPayload, AgentStatusRow } from "@/lib/agent-status-types";
import type { WorkerDeploymentFetch } from "@/lib/cloudflare-workers";
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

function workerDeployment(id: string): WorkerDeployment {
  return { deployedAt: 1, versions: [{ id, percentage: 100 }], commit: null };
}

function deploymentPayload(ids: Record<"api" | "ingress" | "collector", string | null>, fetchedAt = 10): CloudflareDeploymentsPayload {
  return {
    fetchedAt,
    workers: (["api", "ingress", "collector"] as const).map((name) => ({
      name,
      deployment: ids[name] == null ? null : workerDeployment(ids[name]),
    })),
  };
}

test("cloudflare deployments keep the last good cell when one read fails, and clear a confirmed empty list", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, deploymentPayload({ api: "api-v", ingress: "ing-v", collector: "col-v" }), 10);
  const fetched: WorkerDeploymentFetch[] = [
    { deployment: workerDeployment("api-v2"), error: null },
    { deployment: null, error: "The operation was aborted due to timeout" },
    { deployment: null, error: null },
  ];
  const { failed } = await refreshCloudflareDeployments(lag, async () => fetched, 20);
  assert.deepEqual(failed, ["ingress"]);
  const stored = await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments);
  assert.equal(stored?.updatedAt, 20);
  assert.equal(stored?.data.fetchedAt, 20);
  assert.equal(stored?.data.workers[0].deployment?.versions[0].id, "api-v2");
  assert.equal(stored?.data.workers[1].deployment?.versions[0].id, "ing-v");
  assert.equal(stored?.data.workers[2].deployment, null);
});

test("cloudflare deployments keep a commit for the same version when this round did not get one", async () => {
  const lag = new MemoryKv();
  const sha = "ab".repeat(20);
  const previous = deploymentPayload({ api: "api-v", ingress: "ing-v", collector: "col-v" });
  previous.workers[0].deployment = { ...workerDeployment("api-v"), commit: { sha, branch: "main", message: "feat" } };
  previous.workers[1].deployment = { ...workerDeployment("ing-v"), commit: { sha, branch: "main", message: "feat" } };
  previous.workers[2].deployment = { ...workerDeployment("col-v"), commit: { sha, branch: "main", message: "old" } };
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, previous, 10);
  const { failed } = await refreshCloudflareDeployments(lag, async () => [
    { deployment: { ...workerDeployment("api-v"), deployedAt: 2, commit: { sha, branch: "main", message: "feat 2" } }, error: null },
    { deployment: { ...workerDeployment("ing-v"), deployedAt: 3 }, error: null },
    { deployment: workerDeployment("col-v2"), error: null },
  ], 20);
  assert.deepEqual(failed, []);
  const stored = (await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.data.workers;
  assert.equal(stored?.[0].deployment?.commit?.message, "feat 2");
  assert.equal(stored?.[0].deployment?.deployedAt, 2);
  assert.equal(stored?.[1].deployment?.commit?.message, "feat");
  assert.equal(stored?.[1].deployment?.deployedAt, 3);
  assert.equal(stored?.[2].deployment?.versions[0].id, "col-v2");
  assert.equal(stored?.[2].deployment?.commit, null);
});

test("cloudflare deployments do not write when every worker read fails", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, deploymentPayload({ api: "api-v", ingress: null, collector: null }), 10);
  const failedRead = (error: string): WorkerDeploymentFetch => ({ deployment: null, error });
  await assert.rejects(
    refreshCloudflareDeployments(lag, async () => [
      failedRead("Cloudflare 查询失败 (500)"),
      failedRead("Unexpected end of JSON input"),
      failedRead("The operation was aborted due to timeout"),
    ], 30),
    /一个都没取到/,
  );
  const stored = await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments);
  assert.equal(stored?.updatedAt, 10);
  assert.equal(stored?.data.workers[0].deployment?.versions[0].id, "api-v");
});
