import { cacheLife } from "next/cache";

import { fetchRepoStats, repoIdFromUrl } from "@/lib/github-repo";
import { site } from "@/lib/site";
import type { GithubRepoPayload } from "@/lib/types";

/**
 * 首页贡献统计，构建期取一次、焊进 HTML。
 *
 * 和最近提交、头像内联同一套：`use cache` + `cacheLife("max")`，缓存键隐含
 * build ID，每次部署换一份；部署之间首页按 tag 失效重建时不会再打 GitHub。
 * 仓库有新提交就等于一次新部署，所以不需要更勤的刷新，也不需要 Worker。
 *
 * 失败**不能抛**：`use cache` 里抛出去的错在构建期预渲染会直接让 `next build`
 * 失败（实测），而不是交给调用方接。所以在这里接住、返回 null，并给这份空结果
 * 一条短命的 cacheLife —— 和首页快照同节奏，下一轮后台重建就重拉，不会把
 * 「没统计」冻到下次部署。cacheLife 按分支只调用一次（文档要求）。
 *
 * 单独成文件是为了让 `github-repo.ts` 不引 next/cache，单测直接跑。
 */
export async function getGithubRepoStats(): Promise<GithubRepoPayload | null> {
  "use cache";

  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const { owner, name } = repoIdFromUrl(site.repo);
  try {
    const stats = await fetchRepoStats(token, owner, name);
    cacheLife("max");
    return stats;
  } catch (error) {
    console.error("[github-repo]", error instanceof Error ? error.message : String(error));
    cacheLife({ stale: 300, revalidate: 600, expire: 3_600 });
    return null;
  }
}
