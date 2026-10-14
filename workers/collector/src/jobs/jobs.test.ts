import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import type { AgentStatusPayload, AgentStatusRow } from "@shared/agent-status-types";
import { HEARTBEAT_SERIES, UPTIME_SERIES, recordCheck } from "@shared/health";
import type { HealthPayload } from "@shared/health-types";
import { ContributorsUnavailable } from "@shared/github-repo";
import type { GithubRepoPayload } from "@shared/types";

import { MemoryKv } from "../testing/memory-kv";
import { historyDb } from "../testing/sqlite-history";
import type { Env } from "../env";
import { mergeRepoStats, refreshGithubRepo } from "./github-repo";
import { appleRecentJob } from "./apple-recent";
import { refreshProviderStatus } from "./provider-status";
import { siteHealthJob } from "./site-health";
import { siteAnalyticsJob, siteDeploymentsJob } from "./site-status";
import { probeSite, uptimeProbeJob } from "./uptime-probe";

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

const HEALTH_SITES = JSON.stringify({ "lyjw.me": "a".repeat(32), "lyjw131.com": "b".repeat(32) });

function cloudflareHealthFetch(options: { vitalsDown?: boolean } = {}) {
  return async (url: string | URL, init?: RequestInit) => {
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
  };
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
  const fetches = t.mock.method(globalThis, "fetch", cloudflareHealthFetch());

  assert.deepEqual(await siteHealthJob.run({ env, now, scheduled: true }), { status: "ok" });
  const first = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.equal(first.heartbeat?.status, "up");
  assert.equal(first.uptime?.status, "down");
  assert.equal(first.uptime?.intervalSeconds, 60);
  assert.deepEqual(first.errors, { site: { count12h: 3, count7d: 30, unresolved: 0 }, worker: { count12h: 1, count7d: 15, unresolved: 2 } });
  assert.deepEqual(first.vitals, { lcpP75Ms: 609, inpP75Ms: 48, clsP75: 0.001, fcpP75Ms: 588, ttfbP75Ms: null, samples: 44 });
  assert.equal(all("SELECT COUNT(*) AS n FROM health_buckets")[0].n, 2, "超出保留期的格子被清掉");

  fetches.mock.mockImplementation(cloudflareHealthFetch({ vitalsDown: true }));
  assert.deepEqual(await siteHealthJob.run({ env, now: now + 300_000, scheduled: true }), { status: "ok", detail: "vitals carried over" });
  const second = (await readLag<HealthPayload>(lag, LAG_KEYS.health))!.data;
  assert.deepEqual(second.vitals, first.vitals);
  assert.equal(second.blockAt?.vitals, now);
});

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
