import { cacheLife } from "next/cache";

import { type CommitAuthor, type CommitListItem, actorAuthor, commitTitle, mergeAuthors, parseCoAuthors, primaryAuthor } from "@/lib/commit-authors";
import { repoIdFromUrl } from "@/lib/github-repo";
import { FIRST_SCREEN_CACHE_LIFE } from "@/lib/first-screen";
import { site } from "@/lib/site";


export type GithubRecentCommit = {
  sha: string;
  shortSha: string;
  title: string;
  url: string;
  authors: CommitAuthor[];
  committedAt: string | null;
  verified: boolean;
};

const RECENT_LIMIT = 3;

export async function getRecentCommits(): Promise<GithubRecentCommit[]> {
  "use cache";

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  const { owner, name } = repoIdFromUrl(site.repo);
  const url = new URL(`https://api.github.com/repos/${owner}/${name}/commits`);
  url.searchParams.set("per_page", String(RECENT_LIMIT));
  // 只为我们自己的缓存键服务：GitHub 忽略未知的查询参数，行为不变。
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
      cacheLife(FIRST_SCREEN_CACHE_LIFE);
      return [];
    }
    // REST 只关联主作者；GraphQL authors 包含 GitHub 识别的协作者及其真实头像。
    const githubAuthors = new Map<string, CommitAuthor[]>();
    if (token) {
      try {
        const shas = body.map(item => item.sha).filter((sha): sha is string => !!sha && /^[a-f0-9]{40}$/i.test(sha));
        const fields = shas.map((sha, i) => `c${i}: object(oid: "${sha}") { ... on Commit { authors(first: 100) { nodes { name email avatarUrl user { login } } } } }`).join("\n");
        const response = await fetch("https://api.github.com/graphql", {
          method: "POST", headers, cache: "force-cache", signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({ query: `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }` }),
        });
        const result = await response.json() as { data?: { repository?: Record<string, { authors?: { nodes?: { name: string; email: string; avatarUrl: string; user: { login: string } | null }[] } }> } };
        if (!response.ok || !result.data?.repository) throw new Error("GitHub authors unavailable");
        shas.forEach((sha, i) => {
          const nodes = result.data?.repository?.[`c${i}`]?.authors?.nodes;
          if (nodes?.length) githubAuthors.set(sha, mergeAuthors(null, nodes.map(author => actorAuthor({
            name: author.name, email: author.email, login: author.user?.login ?? null, avatarUrl: author.avatarUrl,
          }))));
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
          title: commitTitle(message),
          url: item.html_url?.trim() || `${site.repo}/commit/${sha}`,
          authors: githubAuthors.get(sha) ?? mergeAuthors(primaryAuthor(item), parseCoAuthors(message)),
          committedAt: item.commit?.author?.date ?? null,
          verified: Boolean(item.commit?.verification?.verified),
        },
      ];
    });
    if (commits.length === 0) {
      cacheLife(FIRST_SCREEN_CACHE_LIFE);
      return commits;
    }
    if (commits.every(commit => githubAuthors.has(commit.sha))) cacheLife("max");
    else cacheLife(FIRST_SCREEN_CACHE_LIFE);
    return commits;
  } catch (error) {
    console.error(
      "[github-commits]",
      error instanceof Error ? error.message : String(error),
    );
    cacheLife(FIRST_SCREEN_CACHE_LIFE);
    return [];
  }
}
