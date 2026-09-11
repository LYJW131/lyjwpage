import { cached } from "@/lib/cache";
import { site } from "@/lib/site";
import type {
  GithubRepoContributor,
  GithubRepoPayload,
  GithubRepoWeek,
} from "@/lib/types";

/**
 * 本仓库的贡献统计，走 GitHub REST `/stats/contributors`。
 *
 * token 复用 GITHUB_TOKEN（和贡献日历同一把，不新增配置）：读公开仓的统计
 * 不需要组织权限，classic / fine-grained 都能用。没配则返回空负载，卡片不渲染；
 * GitHub 挂了要抛出去，交给 statusEnvelope 变成 ok:false，轮询那轮才不会把
 * 上一份好数据盖掉。
 *
 * 这路和贡献日历的区别：日历是 GraphQL 按人拉全年，统计是 REST 按仓拉每周，
 * 缓存键和 TTL 各走各的。统计更新得慢（GitHub 自己也在缓存），TTL 取 30 分钟。
 */

const REPO_STATS_CACHE_KEY = "github-repo:v1";
const REPO_STATS_TTL_MS = 30 * 60_000;

/** 卡片上画最近几周，原始返回的一整年不进信封。 */
const WEEK_WINDOW = 12;

type ContributorWeek = {
  w?: number;
  a?: number;
  d?: number;
  c?: number;
};

export type ContributorStat = {
  author?: { login?: string; avatar_url?: string } | null;
  total?: number;
  weeks?: ContributorWeek[];
};

/** 从 site.repo 抠出 owner/name，抠不出就退回 githubLogin/lyjwpage。 */
export function repoIdFromUrl(url: string): { owner: string; name: string } {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (match?.[1] && match?.[2]) return { owner: match[1], name: match[2] };
  return { owner: site.githubLogin, name: "lyjwpage" };
}

const numberOrZero = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/**
 * 把 `/stats/contributors` 的原始返回汇总成卡片要的形状。纯函数，不碰网络，
 * 方便单测。now 只为可测试，线上调用传 Date.now()。
 */
export function summarizeRepoStats(
  raw: ContributorStat[],
  owner: string,
  name: string,
  now: number,
  weekWindow: number = WEEK_WINDOW,
): GithubRepoPayload {
  const contributors: GithubRepoContributor[] = raw.map((entry) => {
    const weeks = Array.isArray(entry.weeks) ? entry.weeks : [];
    let additions = 0;
    let deletions = 0;
    for (const week of weeks) {
      additions += numberOrZero(week.a);
      deletions += numberOrZero(week.d);
    }
    return {
      login: entry.author?.login?.trim() || "ghost",
      avatarUrl: entry.author?.avatar_url ?? null,
      commits: numberOrZero(entry.total),
      additions,
      deletions,
    };
  });
  contributors.sort((left, right) => right.commits - left.commits);

  const byWeek = new Map<number, GithubRepoWeek>();
  for (const entry of raw) {
    for (const week of Array.isArray(entry.weeks) ? entry.weeks : []) {
      const start = numberOrZero(week.w) * 1000;
      if (!start) continue;
      const row = byWeek.get(start) ?? { weekStart: start, commits: 0, additions: 0, deletions: 0 };
      row.commits += numberOrZero(week.c);
      row.additions += numberOrZero(week.a);
      row.deletions += numberOrZero(week.d);
      byWeek.set(start, row);
    }
  }
  const weeks = [...byWeek.values()].sort((left, right) => left.weekStart - right.weekStart);
  const tail = weeks.slice(Math.max(0, weeks.length - Math.max(1, weekWindow)));

  return {
    repo: `${owner}/${name}`,
    fetchedAt: now,
    totals: {
      commits: contributors.reduce((sum, item) => sum + item.commits, 0),
      additions: contributors.reduce((sum, item) => sum + item.additions, 0),
      deletions: contributors.reduce((sum, item) => sum + item.deletions, 0),
      contributors: contributors.length,
    },
    contributors,
    weeks: tail,
  };
}

const EMPTY_REPO: GithubRepoPayload = {
  repo: "",
  fetchedAt: 0,
  totals: { commits: 0, additions: 0, deletions: 0, contributors: 0 },
  contributors: [],
  weeks: [],
};

export async function getGithubRepo(): Promise<GithubRepoPayload> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return EMPTY_REPO;

  const { owner, name } = repoIdFromUrl(site.repo);
  return cached(REPO_STATS_CACHE_KEY, REPO_STATS_TTL_MS, () => fetchRepoStats(token, owner, name));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRepoStats(token: string, owner: string, name: string): Promise<GithubRepoPayload> {
  /**
   * 统计是 GitHub 现算的，第一趟经常回 202（正在生成）。等两秒再问，最多四轮，
   * 加起来仍在取数预算内；还算不出来就抛出去，卡片保留上一份而不是画半截。
   */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/stats/contributors`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "lyjwpage",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 202) {
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    const body = (await response.json().catch(() => null)) as ContributorStat[] | null;
    if (!response.ok || !Array.isArray(body)) {
      // 上游原文只进日志，理由同 github-chart：报错里可能带令牌状态和配额。
      console.error("[github-repo]", response.status, "仓库统计响应不是预期的形状");
      throw new Error("GitHub 仓库统计取数失败");
    }
    return summarizeRepoStats(body, owner, name, Date.now());
  }
  console.error("[github-repo] 统计一直是 202，放弃这一轮");
  throw new Error("GitHub 仓库统计正在生成中");
}
