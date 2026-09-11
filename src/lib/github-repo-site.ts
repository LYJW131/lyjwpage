import { cacheLife } from "next/cache";

import { fetchRepoStats, repoIdFromUrl } from "@/lib/github-repo";
import { site } from "@/lib/site";
import type { GithubRepoPayload } from "@/lib/types";

const EMPTY_REPO: GithubRepoPayload = {
  repo: "",
  fetchedAt: 0,
  totals: { commits: 0, additions: 0, deletions: 0, contributors: 0 },
  contributors: [],
  weeks: [],
};

/**
 * 站点首页回退用：Worker 快照还没有 githubRepo 时（旧后端 / 本地开发）自己拉。
 *
 * 不用 lib/cache 的 `cached()`——那里面有 Date.now()，在 Cache Components
 * 预渲染里会触发 blocking-prerender-current-time。这里走 `use cache`，
 * 和头像内联、最近提交同一套。单独文件避免 Worker 去解析 next/cache。
 *
 * `buildId` 进参数：失败时空结果不能永远冻住，换一次构建键就重拉。
 * 站点侧重试压到 3 轮，避免把整页卡住近一分钟。
 */
export async function getGithubRepoForSite(buildId: string): Promise<GithubRepoPayload> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 1_800, expire: 86_400 });

  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return EMPTY_REPO;

  const { owner, name } = repoIdFromUrl(site.repo);
  // buildId 只参与缓存键，取数本身不依赖它。
  void buildId;
  return fetchRepoStats(token, owner, name, 3);
}
