import { cacheLife } from "next/cache";

import { repoIdFromUrl } from "@/lib/github-repo";
import { site } from "@/lib/site";

/**
 * 首页「最近提交」列表。构建期焊进 HTML，不走 /api/status、也不轮询。
 *
 * 和头像内联同一套：`cacheLife("max")` + `BUILD_TIME` 进缓存键，每次部署换一份；
 * 部署之间页面按 tag 失效重建时也不会反复打 GitHub。公开仓不配令牌也能读，
 * 有 GITHUB_TOKEN 就带上，配额更宽。
 */

export type GithubRecentCommit = {
  sha: string;
  shortSha: string;
  title: string;
  url: string;
  authorLogin: string | null;
  committedAt: string | null;
};

/** 卡片右栏固定 6 行、不滚动，所以只拉 6 条。 */
const RECENT_LIMIT = 6;

type CommitListItem = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { date?: string } | null;
  };
  author?: { login?: string } | null;
};

function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line || "(无标题)";
}

/**
 * 拉本仓库最近若干条提交标题。失败返回空数组，卡片少这一栏，不拖垮首页。
 */
export async function getRecentCommits(): Promise<GithubRecentCommit[]> {
  "use cache";
  cacheLife("max");

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  const { owner, name } = repoIdFromUrl(site.repo);
  const url = new URL(`https://api.github.com/repos/${owner}/${name}/commits`);
  url.searchParams.set("per_page", String(RECENT_LIMIT));
  // 只为我们自己的缓存键服务，GitHub 会忽略未知查询参数以外的行为不变。
  if (buildId) url.searchParams.set("b", buildId);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "lyjwpage",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, {
      headers,
      cache: "force-cache",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json().catch(() => null)) as CommitListItem[] | null;
    if (!response.ok || !Array.isArray(body)) {
      console.error("[github-commits]", response.status, "最近提交响应不是预期的形状");
      return [];
    }
    return body.flatMap((item) => {
      const sha = item.sha?.trim();
      if (!sha) return [];
      const message = item.commit?.message ?? "";
      return [
        {
          sha,
          shortSha: sha.slice(0, 7),
          title: firstLine(message),
          url: item.html_url?.trim() || `${site.repo}/commit/${sha}`,
          authorLogin: item.author?.login?.trim() || null,
          committedAt: item.commit?.author?.date ?? null,
        },
      ];
    });
  } catch (error) {
    console.error(
      "[github-commits]",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}
