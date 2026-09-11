import { cacheLife } from "next/cache";

import { fetchRepoStats, repoIdFromUrl } from "@/lib/github-repo";
import { site } from "@/lib/site";
import type { GithubRepoPayload } from "@/lib/types";

/** 站点侧的总预算；这一步串在首页渲染后面，比 Worker 那边再紧一点。 */
const SITE_BUDGET_MS = 8_000;

/**
 * 站点首页回退用：Worker 快照还没有 githubRepo 时（旧后端 / 本地开发）自己拉。
 *
 * 不用 lib/cache 的 `cached()`——那里面有 Date.now()，在 Cache Components
 * 预渲染里会触发 blocking-prerender-current-time。这里走 `use cache`，
 * 和头像内联、最近提交同一套。单独文件避免 Worker 去解析 next/cache。
 *
 * 公开仓不配 GITHUB_TOKEN 也能读（和最近提交一样），Vercel 上配了就带上，
 * 免得撞匿名限额。`buildId` 进参数：失败时空结果不能永远冻住，换一次构建键
 * 就重拉。
 */
export async function getGithubRepoForSite(buildId: string): Promise<GithubRepoPayload> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1_800, expire: 86_400 });

  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const { owner, name } = repoIdFromUrl(site.repo);
  // buildId 只参与缓存键，取数本身不依赖它。
  void buildId;
  return fetchRepoStats(token, owner, name, SITE_BUDGET_MS);
}
