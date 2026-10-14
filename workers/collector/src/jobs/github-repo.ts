import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { ContributorsUnavailable, fetchRecentCommits, fetchRepoStats, repoIdFromUrl, type RepoTotals } from "@shared/github-repo";
import { site } from "@shared/site";
import type { StateCoreRpc } from "@shared/state-core";
import type { GithubRepoCommit, GithubRepoPayload } from "@shared/types";

import { explain, ok, skipMissing, type Job, type JobResult } from "../job";

const FETCH_BUDGET_MS = 60_000;
// 部署后的重拉跑在上报入口的 waitUntil 里（约 30 秒），刚推送时统计接口多半一直回 202，得在窗口内收手把最近提交写进去。
const REFRESH_BUDGET_MS = 15_000;
const COMMITS_BUDGET_MS = 10_000;
const REPO_TAG = "github-repo";

const hasTotals = (totals: RepoTotals) => totals.commits != null;

export function mergeRepoStats(
  fresh: { ok: true; data: GithubRepoPayload } | { ok: false; totals: RepoTotals },
  previous: GithubRepoPayload | null,
  now = Date.now(),
): GithubRepoPayload | null {
  if (fresh.ok) {
    if (hasTotals(fresh.data.totals)) return { ...fresh.data, totalsAt: fresh.data.fetchedAt };
    if (!previous || !hasTotals(previous.totals)) return fresh.data;
    const { commits, additions, deletions } = previous.totals;
    return {
      ...fresh.data,
      totals: { ...fresh.data.totals, commits, additions, deletions },
      totalsAt: previous.totalsAt ?? previous.fetchedAt,
    };
  }
  if (!previous || !hasTotals(fresh.totals)) return null;
  return { ...previous, totals: { ...fresh.totals, contributors: previous.totals.contributors }, totalsAt: now };
}

const commitKeys = (commits: GithubRepoCommit[] | undefined) => (commits ?? []).map((commit) => commit.oid ?? commit.sha).join();
const headTime = (commits: GithubRepoCommit[] | undefined) => Date.parse(commits?.[0]?.committedAt ?? "") || 0;

type RepoFetchers = {
  commits: (budgetMs: number) => Promise<GithubRepoCommit[]>;
  stats: (budgetMs: number) => Promise<GithubRepoPayload>;
};

function liveFetchers(token: string): RepoFetchers {
  const { owner, name } = repoIdFromUrl(site.repo);
  return {
    commits: (budgetMs) => fetchRecentCommits(token, owner, name, budgetMs),
    stats: (budgetMs) => fetchRepoStats(token, owner, name, budgetMs),
  };
}

type RepoDeps = { lag: LagStore; core: Pick<StateCoreRpc, "revalidate">; fetchers: RepoFetchers };

async function publish(deps: RepoDeps, previous: GithubRepoPayload | null, next: GithubRepoPayload, updatedAt?: number) {
  // 定时任务和部署后的重拉会并发，慢的一轮不能拿更旧的提交盖掉快的一轮已经写下的。
  const latest = (await readLag<GithubRepoPayload>(deps.lag, LAG_KEYS.githubRepo))?.data;
  if (latest && headTime(latest.recentCommits) > headTime(next.recentCommits)) next = { ...next, recentCommits: latest.recentCommits };
  await writeLag(deps.lag, LAG_KEYS.githubRepo, next, updatedAt);
  if (commitKeys(previous?.recentCommits) === commitKeys(next.recentCommits)) return;
  try {
    await deps.core.revalidate([REPO_TAG]);
  } catch (error) {
    console.warn("[github-repo] revalidate", explain(error));
  }
}

export async function refreshGithubRepo(deps: RepoDeps, scheduled: boolean): Promise<JobResult> {
  const stored = await readLag<GithubRepoPayload>(deps.lag, LAG_KEYS.githubRepo);
  const previous = stored?.data ?? null;
  let commitsFresh = true;
  const commits = deps.fetchers.commits(COMMITS_BUDGET_MS).catch((error: unknown) => {
    commitsFresh = false;
    console.warn("[github-repo]", explain(error), "；最近提交沿用上一份");
    return previous?.recentCommits;
  });
  let fresh: Parameters<typeof mergeRepoStats>[0];
  try {
    fresh = { ok: true, data: await deps.fetchers.stats(scheduled ? FETCH_BUDGET_MS : REFRESH_BUDGET_MS) };
  } catch (error) {
    if (!(error instanceof ContributorsUnavailable)) throw error;
    console.warn("[github-repo]", error.message, "；名单沿用上一份");
    fresh = { ok: false, totals: error.totals };
  }
  const merged = mergeRepoStats(fresh, previous);
  const recentCommits = await commits;
  if (merged) {
    await publish(deps, previous, recentCommits ? { ...merged, recentCommits } : merged);
    return ok(fresh.ok ? undefined : "contributors carried over");
  }
  if (!stored || !recentCommits || !commitsFresh) throw new Error("GitHub 仓库统计这轮没有可写的结果（名单没取到，也没有上一份可沿用）");
  // 统计这轮取不到时新提交照样并进上一份，但 updatedAt 留旧值，卡片照常显出统计过时；定时任务仍报错。
  await publish(deps, stored.data, { ...stored.data, recentCommits }, stored.updatedAt);
  if (scheduled) throw new Error("GitHub 仓库统计这轮没有结果，只并进了最近提交");
  return ok("stats carried over");
}

export const githubRepoJob: Job = {
  name: "github-repo",
  everyMinutes: 30,
  offset: 2,
  async run({ env, scheduled }) {
    // Workers 出口共享匿名限额；总数接口也要求令牌，不能仅凭名单可匿名读就省略它。
    const token = env.GITHUB_TOKEN?.trim();
    if (!token) return skipMissing("github-repo", ["GITHUB_TOKEN"]);
    return refreshGithubRepo({ lag: env.LAG, core: env.CORE, fetchers: liveFetchers(token) }, scheduled);
  },
};
