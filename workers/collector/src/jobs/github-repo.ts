import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { ContributorsUnavailable, fetchRepoStats, repoIdFromUrl, type RepoTotals } from "@/lib/github-repo";
import { site } from "@/lib/site";
import type { GithubRepoPayload } from "@/lib/types";

import { ok, skipMissing, type Job } from "../job";

/**
 * 本仓库统计（贡献者名单 + 提交数与增删行），每 30 分钟一轮。
 *
 * 名单和总数是两个接口、两种失败方式，和从前 last-good 的合并口径一样：
 * - 都取到了：整份写入；
 * - 只有总数没取到：名单用新的，总数沿用上一份（不拿「—」盖掉好的数字）；
 * - 只有名单没取到（GitHub 在 push 后重算，一直回 202）：名单沿用上一份，总数用新的；
 * - 都没取到：不写，上一份原样留着。
 *
 * 增删行的累计锚经 src/lib/cache 存在 COLLECTOR_KV（30 天）。没有谁在等这一轮，
 * 预算从读路径时代的 12 秒放宽到 60 秒，多等几轮 202。
 */
const FETCH_BUDGET_MS = 60_000;

const hasTotals = (totals: RepoTotals) => totals.commits != null;

export function mergeRepoStats(
  fresh: { ok: true; data: GithubRepoPayload } | { ok: false; totals: RepoTotals },
  previous: GithubRepoPayload | null,
): GithubRepoPayload | null {
  if (fresh.ok) {
    if (hasTotals(fresh.data.totals) || !previous || !hasTotals(previous.totals)) return fresh.data;
    const { commits, additions, deletions } = previous.totals;
    return { ...fresh.data, totals: { ...fresh.data.totals, commits, additions, deletions } };
  }
  if (!previous || !hasTotals(fresh.totals)) return null;
  return { ...previous, totals: { ...fresh.totals, contributors: previous.totals.contributors } };
}

export const githubRepoJob: Job = {
  name: "github-repo",
  everyMinutes: 30,
  offset: 2,
  maxRuntimeMinutes: 3,
  async run({ env }) {
    // 名单那半匿名也能读，但限额按 IP 算、Workers 出口共享；总数那半没有令牌根本取不到
    const token = env.GITHUB_TOKEN?.trim();
    if (!token) return skipMissing("github-repo", ["GITHUB_TOKEN"]);
    const { owner, name } = repoIdFromUrl(site.repo);
    const previous = (await readLag<GithubRepoPayload>(env.LAG, LAG_KEYS.githubRepo))?.data ?? null;
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
    await writeLag(env.LAG, LAG_KEYS.githubRepo, merged);
    return ok(fresh.ok ? undefined : "contributors carried over");
  },
};
