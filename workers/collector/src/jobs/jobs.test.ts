import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import type { AgentStatusPayload, AgentStatusRow } from "@shared/agent-status-types";
import { PAGESPEED_TIMEOUT_MS } from "../pagespeed";
import { mergeSentryStatus, SENTRY_BLOCK_CARRY_MS } from "@shared/sentry-status";
import type { SentryStatusPayload } from "@shared/sentry-status-types";
import { ContributorsUnavailable } from "@shared/github-repo";
import type { GithubRepoPayload } from "@shared/types";

import { MemoryKv } from "../testing/memory-kv";
import type { Env } from "../env";
import { mergeRepoStats, refreshGithubRepo } from "./github-repo";
import { pagespeedJob } from "./pagespeed";
import { refreshProviderStatus } from "./provider-status";
import { siteAnalyticsJob, siteDeploymentsJob } from "./site-status";

const noEnv = {} as Env;
const now = 1_700_000_000_000;

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

const commit = (sha: string, day: number) => ({ sha, title: sha, authors: ["p0"], committedAt: `2026-10-0${day}T00:00:00Z` });

test("repo rounds land fresh commits while stats are pending, without hiding stale stats", async () => {
  const lag = new MemoryKv();
  const revalidated: string[][] = [];
  const core = { revalidate: async (tags: string[]) => { revalidated.push(tags); } };
  const previous = { ...repo(400, 3, 1), recentCommits: [commit("aaaaaaa", 1)] };
  await writeLag(lag, LAG_KEYS.githubRepo, previous, 1);
  const budgets: number[] = [];
  const fetchers = {
    commits: async () => [commit("bbbbbbb", 2), commit("aaaaaaa", 1)],
    stats: async (budgetMs: number) => {
      budgets.push(budgetMs);
      throw new ContributorsUnavailable("202", { commits: null, additions: null, deletions: null });
    },
  };

  await assert.rejects(refreshGithubRepo({ lag, core, fetchers }, true));
  const entry = await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo);
  assert.deepEqual(entry?.data.recentCommits?.map((entry) => entry.sha), ["bbbbbbb", "aaaaaaa"]);
  assert.deepEqual(entry?.data.totals, previous.totals);
  assert.equal(entry?.updatedAt, 1, "统计没取到，updatedAt 不前进");
  assert.deepEqual(revalidated, [["github-repo"]]);

  assert.deepEqual(await refreshGithubRepo({ lag, core, fetchers }, false), { status: "ok", detail: "stats carried over" });
  assert.equal(revalidated.length, 1, "提交没变不清首屏");
  assert.ok(budgets[1] < budgets[0], "部署后的重拉统计预算更短");
});

test("a slower repo round never rolls the commit list back", async () => {
  const lag = new MemoryKv();
  const core = { revalidate: async () => {} };
  await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(400, 3, 1), recentCommits: [commit("aaaaaaa", 1)] }, 1);
  const fetchers = {
    commits: async () => [commit("bbbbbbb", 2)],
    stats: async () => {
      await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(401, 3, 2), recentCommits: [commit("ccccccc", 3)] }, 2);
      return repo(402, 3, 3);
    },
  };

  await refreshGithubRepo({ lag, core, fetchers }, true);
  const written = (await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo))?.data;
  assert.equal(written?.recentCommits?.[0]?.sha, "ccccccc");
  assert.equal(written?.totals.commits, 402);
});
