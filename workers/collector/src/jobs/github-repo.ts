import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { ContributorsUnavailable, fetchRecentCommits, fetchRepoStats, repoIdFromUrl, type RepoTotals } from "@/lib/github-repo";
import { site } from "@/lib/site";
import type { GithubRepoPayload } from "@/lib/types";

import { ok, skipMissing, type Job } from "../job";

const FETCH_BUDGET_MS = 60_000;
const COMMITS_BUDGET_MS = 10_000;

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

export const githubRepoJob: Job = {
  name: "github-repo",
  everyMinutes: 30,
  offset: 2,
  maxRuntimeMinutes: 3,
  async run({ env }) {
    // Workers 出口共享匿名限额；总数接口也要求令牌，不能仅凭名单可匿名读就省略它。
    const token = env.GITHUB_TOKEN?.trim();
    if (!token) return skipMissing("github-repo", ["GITHUB_TOKEN"]);
    const { owner, name } = repoIdFromUrl(site.repo);
    const previous = (await readLag<GithubRepoPayload>(env.LAG, LAG_KEYS.githubRepo))?.data ?? null;
    const commits = fetchRecentCommits(token, owner, name, COMMITS_BUDGET_MS).catch((error: unknown) => {
      console.warn("[github-repo]", error instanceof Error ? error.message : String(error), "；最近提交沿用上一份");
      return previous?.recentCommits;
    });
    let fresh: Parameters<typeof mergeRepoStats>[0];
    try {
      fresh = { ok: true, data: await fetchRepoStats(token, owner, name, FETCH_BUDGET_MS) };
    } catch (error) {
      if (!(error instanceof ContributorsUnavailable)) throw error;
      console.warn("[github-repo]", error.message, "；名单沿用上一份");
      fresh = { ok: false, totals: error.totals };
    }
    const merged = mergeRepoStats(fresh, previous);
    if (!merged) throw new Error("GitHub 仓库统计这轮没有可写的结果（名单没取到，也没有上一份可沿用）");
    const recentCommits = await commits;
    await writeLag(env.LAG, LAG_KEYS.githubRepo, recentCommits ? { ...merged, recentCommits } : merged);
    return ok(fresh.ok ? undefined : "contributors carried over");
  },
};
