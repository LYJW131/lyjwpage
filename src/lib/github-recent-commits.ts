import { cacheLife } from "next/cache";

import { type CommitAuthor, authorFromTrailer, mergeAuthors, parseCoAuthors } from "@/lib/commit-authors";
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
  /** 作者在前，`Co-authored-by` 的协作者接上，见 commit-authors */
  authors: CommitAuthor[];
  committedAt: string | null;
};

/** 卡片右栏固定 3 张提交卡、不滚动，所以只拉 3 条。 */
const RECENT_LIMIT = 3;

type CommitListItem = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string } | null;
  };
  author?: { login?: string; avatar_url?: string } | null;
};

/** 提交的作者：对上了 GitHub 账号就用登录名和头像，否则解析 agent 或 git 里的名字。 */
function primaryAuthor(item: CommitListItem): CommitAuthor | null {
  const login = item.author?.login?.trim();
  const avatarUrl = item.author?.avatar_url?.trim() || null;

  // 1. GitHub 官方已经关联到账号，直接信任 GitHub 数据
  if (login) {
    return {
      name: login,
      login,
      avatarUrl,
      agent: login === "cursoragent" ? "cursor" : null,
    };
  }

  // 2. 没关联上账号时，尝试从 git author email 解析（如 agent 固定邮箱或 noreply 邮箱）
  const email = item.commit?.author?.email?.trim() || "";
  const name = item.commit?.author?.name?.trim() || "";
  if (email) {
    const candidate = authorFromTrailer(name, email);
    if (candidate.login || candidate.name || candidate.agent) return candidate;
  }

  return name ? { name, login: null, avatarUrl: null, agent: null } : null;
}

function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line || "(无标题)";
}

/**
 * 拉本仓库最近若干条提交标题。失败返回空数组，卡片少这一栏，不拖垮首页。
 *
 * `cacheLife` 分支写：**拿到了**才冻到下次部署，空手而归只缓存几分钟。
 * 首页不是纯静态 —— 每次 ingest 按 tag 失效后会在某个区域重新渲染，那一次
 * 在本区域是冷的、要真打一次 GitHub。未鉴权配额是每小时 60 次/IP，撞上 403
 * 就会渲染出一份没有提交栏的 HTML；要是这份也按 `max` 缓存，等于一次瞬时
 * 限流把这一栏冻到下次部署为止（2026-09-13 就这么丢过一次，见 README）。
 */
export async function getRecentCommits(): Promise<GithubRecentCommit[]> {
  "use cache";

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
      cacheLife("minutes");
      return [];
    }
    // REST 只关联主作者；GraphQL authors 包含 GitHub 识别的协作者及其真实头像。
    const githubAuthors = new Map<string, CommitAuthor[]>();
    if (token) {
      try {
        const shas = body.map(item => item.sha).filter((sha): sha is string => !!sha && /^[a-f0-9]{40}$/i.test(sha));
        const fields = shas.map((sha, i) => `c${i}: object(oid: "${sha}") { ... on Commit { authors(first: 100) { nodes { name avatarUrl user { login } } } } }`).join("\n");
        const response = await fetch("https://api.github.com/graphql", {
          method: "POST", headers, cache: "force-cache", signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({ query: `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }` }),
        });
        const result = await response.json() as { data?: { repository?: Record<string, { authors?: { nodes?: { name: string; avatarUrl: string; user: { login: string } | null }[] } }> } };
        if (!response.ok || !result.data?.repository) throw new Error("GitHub authors unavailable");
        shas.forEach((sha, i) => {
          const nodes = result.data?.repository?.[`c${i}`]?.authors?.nodes;
          if (nodes?.length) githubAuthors.set(sha, nodes.map(author => ({
            name: author.user?.login ?? author.name, login: author.user?.login ?? null,
            avatarUrl: author.avatarUrl, agent: null,
          })));
        });
      } catch (error) {
        console.error("[github-commits] authors", error instanceof Error ? error.message : String(error));
      }
    }
    const commits = body.flatMap((item) => {
      const sha = item.sha?.trim();
      if (!sha) return [];
      const message = item.commit?.message ?? "";
      return [
        {
          sha,
          shortSha: sha.slice(0, 7),
          title: firstLine(message),
          url: item.html_url?.trim() || `${site.repo}/commit/${sha}`,
          authors: githubAuthors.get(sha) ?? mergeAuthors(primaryAuthor(item), parseCoAuthors(message)),
          committedAt: item.commit?.author?.date ?? null,
        },
      ];
    });
    if (commits.length === 0) {
      // 响应是 200 但一条都没解析出来，同样按「没拿到」处理，别冻住。
      cacheLife("minutes");
      return commits;
    }
    if (commits.every(commit => githubAuthors.has(commit.sha))) cacheLife("max");
    else cacheLife("minutes");
    return commits;
  } catch (error) {
    console.error(
      "[github-commits]",
      error instanceof Error ? error.message : String(error),
    );
    cacheLife("minutes");
    return [];
  }
}
