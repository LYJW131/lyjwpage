import type { GithubRepoPayload } from "@/lib/types";

/**
 * 读构建期焊进来的仓库贡献统计。
 *
 * 取数在 `next build` 之前由 scripts/fetch-github-repo-stats.mjs 做、落到
 * .next/cache，next.config.ts 读出来经 `env.GITHUB_REPO_STATS` 以字面量内联进
 * 产物 —— 和 BUILD_TIME 同一条路，之后无论冷启动还是首页按 tag 重新生成，
 * 这份都不会再变。仓库有新提交就是一次新部署，自然换新；GitHub 那次没算完
 * 就是上一次构建的那份，最多落后一次部署。
 *
 * 空串表示连上一次的都没有（全新的构建缓存又没等到 GitHub），卡片只剩提交列表。
 */
export function builtGithubRepoStats(): GithubRepoPayload | null {
  const raw = process.env.GITHUB_REPO_STATS;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GithubRepoPayload;
  } catch {
    return null;
  }
}
