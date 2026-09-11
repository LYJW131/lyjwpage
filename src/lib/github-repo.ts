import { cached, get, put } from "@/lib/cache";
import { site } from "@/lib/site";
import type {
  GithubRepoContributor,
  GithubRepoPayload,
  GithubRepoWeek,
} from "@/lib/types";

/**
 * 本仓库的贡献统计，走 GitHub REST `/stats/contributors`。
 *
 * 和贡献日历同一条流程：Worker 取数进 SQLite TTL 缓存，进 `/api/home` 快照，
 * 也有 `/api/status/github-repo` 给浏览器按长间隔轮询；没有推送。
 *
 * token 复用 Worker 上的 GITHUB_TOKEN（和贡献日历同一把）：公开仓不带 token
 * 也能读，只是匿名限额低（每 IP 60 次/小时），有就带上。
 *
 * 这路和贡献日历的区别：日历是 GraphQL 按人拉全年，统计是 REST 按仓拉每周，
 * 缓存键和 TTL 各走各的。统计更新得慢（GitHub 自己也在缓存），TTL 取 30 分钟。
 */

/** 窗口宽度进缓存键：改周数要换键，不然 Worker 里那份旧窗口会再活 30 分钟。 */
const REPO_STATS_CACHE_KEY = "github-repo:v4";
const REPO_STATS_TTL_MS = 30 * 60_000;

/**
 * 最近一次成功的结果，另存一份、活得久。
 *
 * 每次 push 后 GitHub 会作废统计缓存重新排队现算，期间一直回 202，一轮从
 * 30 秒到几分钟都有；30 分钟 TTL 到期恰好撞上这段窗口时，拿这份顶上，
 * 卡片不会因为 GitHub 在算就消失。顶上的那份照样按 30 分钟缓存，下一轮再试。
 */
const LAST_GOOD_KEY = "github-repo:last-good";
const LAST_GOOD_TTL_MS = 7 * 86_400_000;

/**
 * 柱状图只画最近 6 周；原始返回的一整年不进信封。
 * 这个仓的提交集中在最近一两个月，拉到半年只会左边一大片空白。
 */
const WEEK_WINDOW = 6;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * 整次取数的总预算，含等 202 的时间。
 *
 * 这一路挂在 `/api/home` 的 Promise.all 里，而站点 status-cache 20 秒就会掐掉
 * 整个快照请求；不设上限就是让一张卡拖垮整个首页重建。预算内等不到就抛，
 * 由 getGithubRepo 决定用上一次成功的那份顶上。
 */
const FETCH_BUDGET_MS = 12_000;

/** 等 202 的轮询间隔：GitHub 的说法是「过一会儿再来」。 */
const RETRY_INTERVAL_MS = 3_000;

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

function emptyWeek(weekStart: number): GithubRepoWeek {
  return { weekStart, commits: 0, additions: 0, deletions: 0 };
}

/** `ms` 所在周的周日 00:00 UTC（毫秒），对齐 GitHub stats 的 `w`。 */
export function weekStartMs(ms: number): number {
  const date = new Date(ms);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return dayStart - date.getUTCDay() * DAY_MS;
}

/**
 * 把 `/stats/contributors` 的原始返回汇总成卡片要的形状。纯函数，不碰网络，
 * 方便单测。now 决定窗口落在哪几周，线上调用传 Date.now()。
 *
 * 横轴是以 now 所在周收尾、连续往前数 weekWindow 周，不是「原始返回里出现过
 * 的周」：commits 回退只会带有提交的周，stats 也可能在窗尾缺几周，按出现过
 * 的周排会把空档和最近的安静周一起吞掉，等宽柱就对不上日历了。每人的
 * `weeks` 和顶层 `weeks` 共用这组 weekStart，空周补零，柱状图才能并排对齐。
 */
export function summarizeRepoStats(
  raw: ContributorStat[],
  owner: string,
  name: string,
  now: number,
  weekWindow: number = WEEK_WINDOW,
): GithubRepoPayload {
  const count = Math.max(1, Math.floor(weekWindow));
  const lastStart = weekStartMs(now);
  const windowStarts = Array.from(
    { length: count },
    (_, index) => lastStart - (count - 1 - index) * WEEK_MS,
  );

  const contributors: GithubRepoContributor[] = raw.map((entry) => {
    const byStart = new Map<number, GithubRepoWeek>();
    let additions = 0;
    let deletions = 0;
    for (const week of Array.isArray(entry.weeks) ? entry.weeks : []) {
      const start = numberOrZero(week.w) * 1000;
      if (!start) continue;
      const row = {
        weekStart: start,
        commits: numberOrZero(week.c),
        additions: numberOrZero(week.a),
        deletions: numberOrZero(week.d),
      };
      byStart.set(start, row);
      additions += row.additions;
      deletions += row.deletions;
    }
    return {
      login: entry.author?.login?.trim() || "ghost",
      avatarUrl: entry.author?.avatar_url ?? null,
      commits: numberOrZero(entry.total),
      additions,
      deletions,
      weeks: windowStarts.map((start) => byStart.get(start) ?? emptyWeek(start)),
    };
  });
  contributors.sort((left, right) => right.commits - left.commits);

  const weeks: GithubRepoWeek[] = windowStarts.map((start) => {
    const row = emptyWeek(start);
    for (const person of contributors) {
      const week = person.weeks.find((item) => item.weekStart === start);
      if (!week) continue;
      row.commits += week.commits;
      row.additions += week.additions;
      row.deletions += week.deletions;
    }
    return row;
  });

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
    weeks,
  };
}

/** Worker / 公开状态端点用：走 SQLite TTL 缓存，取不到就用上一次成功的顶上。 */
export async function getGithubRepo(): Promise<GithubRepoPayload> {
  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const { owner, name } = repoIdFromUrl(site.repo);
  return cached(REPO_STATS_CACHE_KEY, REPO_STATS_TTL_MS, async () => {
    try {
      const stats = await fetchRepoStats(token, owner, name);
      await put(LAST_GOOD_KEY, stats, LAST_GOOD_TTL_MS);
      return stats;
    } catch (error) {
      const lastGood = await get<GithubRepoPayload>(LAST_GOOD_KEY);
      if (!lastGood) throw error;
      console.warn(
        "[github-repo]",
        error instanceof Error ? error.message : String(error),
        "；沿用上一次成功的统计",
      );
      return lastGood;
    }
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取数本体，不碰缓存层。
 *
 * 只认 `/stats/contributors`（带每人每周 a/d/c）。GitHub 现算时回 202，
 * 就每 5 秒再问一次；整次不超过 budgetMs，一个共享的 AbortSignal 挂在所有
 * fetch 上。预算内等不到、或响应不对，都抛出去 —— 没有 commits 列表那种
 * 退路：它拼不出增删行，「+0 / −0」会在缓存里挂半小时。
 */
export async function fetchRepoStats(
  token: string | null,
  owner: string,
  name: string,
  budgetMs: number = FETCH_BUDGET_MS,
): Promise<GithubRepoPayload> {
  const deadline = Date.now() + budgetMs;
  const signal = AbortSignal.timeout(budgetMs);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "lyjwpage",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; ; attempt += 1) {
    const url = new URL(`https://api.github.com/repos/${owner}/${name}/stats/contributors`);
    // 每轮换个查询参数，免得中间任何一层把同 URL 的 GET 记忆化后一直回第一次
    // 那个 202。GitHub 不认这个参数，行为不变。
    url.searchParams.set("attempt", String(attempt));
    const response = await fetch(url, { headers, signal });
    if (response.status === 202) {
      if (Date.now() + RETRY_INTERVAL_MS > deadline) {
        throw new Error(`GitHub 仓库统计尚未就绪（${attempt + 1} 次 202），这轮不画`);
      }
      await sleep(RETRY_INTERVAL_MS);
      continue;
    }
    const body = (await response.json().catch(() => null)) as ContributorStat[] | null;
    if (!response.ok || !Array.isArray(body)) {
      throw new Error(`GitHub 仓库统计响应不是预期的形状（HTTP ${response.status}）`);
    }
    return summarizeRepoStats(body, owner, name, Date.now());
  }
}
