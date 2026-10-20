import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { ContributorsUnavailable } from "@shared/github-repo";
import type { GithubRepoPayload } from "@shared/types";

import { MemoryKv } from "../testing/memory-kv";
import { mergeRepoStats, refreshGithubRepo } from "./github-repo";

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

test("a repo round preserves commits published while it fetched stats", async () => {
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

test("repo commits follow a force-pushed rollback even when the head date moves backward", async () => {
  const lag = new MemoryKv();
  const revalidated: string[][] = [];
  const core = { revalidate: async (tags: string[]) => { revalidated.push(tags); } };
  await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(401, 3, 2), recentCommits: [commit("bbbbbbb", 2)] });
  const fetchers = {
    commits: async () => [commit("aaaaaaa", 1)],
    stats: async () => repo(400, 3, 3),
  };

  assert.deepEqual(await refreshGithubRepo({ lag, core, fetchers }, true), { status: "ok" });
  const written = (await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo))?.data;
  assert.equal(written?.recentCommits?.[0]?.sha, "aaaaaaa");
  assert.deepEqual(revalidated, [["github-repo"]]);
});

test("a slower repo round preserves a rollback published while it fetched stats", async () => {
  const lag = new MemoryKv();
  const core = { revalidate: async () => {} };
  await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(401, 3, 2), recentCommits: [commit("bbbbbbb", 2)] });
  const fetchers = {
    commits: async () => [commit("bbbbbbb", 2)],
    stats: async () => {
      await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(400, 3, 3), recentCommits: [commit("aaaaaaa", 1)] });
      return repo(401, 3, 4);
    },
  };

  await refreshGithubRepo({ lag, core, fetchers }, true);
  const written = (await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo))?.data;
  assert.equal(written?.recentCommits?.[0]?.sha, "aaaaaaa");
});

test("a repo round aligns with GitHub after deferring to a concurrent publication", async () => {
  const lag = new MemoryKv();
  const core = { revalidate: async () => {} };
  await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(400, 3, 1), recentCommits: [commit("aaaaaaa", 1)] });
  const fetchers = {
    commits: async () => [commit("ccccccc", 3)],
    stats: async () => {
      await writeLag(lag, LAG_KEYS.githubRepo, { ...repo(401, 3, 2), recentCommits: [commit("bbbbbbb", 2)] });
      return repo(402, 3, 3);
    },
  };

  await refreshGithubRepo({ lag, core, fetchers }, true);
  assert.equal((await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo))?.data.recentCommits?.[0]?.sha, "bbbbbbb");

  fetchers.stats = async () => repo(402, 3, 4);
  await refreshGithubRepo({ lag, core, fetchers }, true);
  assert.equal((await readLag<GithubRepoPayload>(lag, LAG_KEYS.githubRepo))?.data.recentCommits?.[0]?.sha, "ccccccc");
});
