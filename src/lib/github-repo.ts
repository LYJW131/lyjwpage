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
 * 不需要组织权限，classic / fine-grained 都能用。公开仓不带 token 也能读，
 * 只是匿名限额低（每 IP 60 次/小时），30 分钟一次的节奏够用；有就带上。
 * GitHub 挂了要抛出去，交给 statusEnvelope 变成 ok:false，轮询那轮才不会把
 * 上一份好数据盖掉。
 *
 * 这路和贡献日历的区别：日历是 GraphQL 按人拉全年，统计是 REST 按仓拉每周，
 * 缓存键和 TTL 各走各的。统计更新得慢（GitHub 自己也在缓存），TTL 取 30 分钟。
 */

const REPO_STATS_CACHE_KEY = "github-repo:v2";
const REPO_STATS_TTL_MS = 30 * 60_000;

/** 每人柱状图画最近几周；原始返回的一整年不进信封。 */
const WEEK_WINDOW = 26;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * 整次取数的总预算，含等 202 和 commits 回退。
 *
 * 这一路挂在 `/api/home` 的 Promise.all 里，而站点 status-cache 20 秒就会掐掉
 * 整个快照请求；GitHub 冷缓存现算时可以连续回 202 十几秒，不设上限就是让
 * 一张卡拖垮整个首页重建。预算之内等不到就退 commits，退不出来就抛。
 */
const FETCH_BUDGET_MS = 12_000;

/** 退到 commits 回退前至少给它留这么多预算，不然退了也白退。 */
const COMMITS_RESERVE_MS = 5_000;

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

/** Worker / 公开状态端点用：走 SQLite TTL 缓存。 */
export async function getGithubRepo(): Promise<GithubRepoPayload> {
  const token = process.env.GITHUB_TOKEN?.trim() || null;
  const { owner, name } = repoIdFromUrl(site.repo);
  return cached(REPO_STATS_CACHE_KEY, REPO_STATS_TTL_MS, () => fetchRepoStats(token, owner, name));
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 给站点回退和 Worker 共用的取数；不碰缓存层。
 *
 * 整次调用（含 202 等待、commits 回退）不超过 budgetMs：一个共享的
 * AbortSignal 挂在所有 fetch 上，等待前先看剩余预算够不够再等一轮。
 */
export async function fetchRepoStats(
  token: string | null,
  owner: string,
  name: string,
  budgetMs: number = FETCH_BUDGET_MS,
): Promise<GithubRepoPayload> {
  /**
   * 优先走 `/stats/contributors`（带每人每周 a/d/c）。GitHub 现算时常回 202；
   * 预算内等不到，就退到 commits 列表按作者/周聚合——没有 ++/--，但柱状图和
   * 排名还能画，本地和 Worker 都不至于整卡空白。
   */
  const deadline = Date.now() + budgetMs;
  const signal = AbortSignal.timeout(budgetMs);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "lyjwpage",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${name}/stats/contributors`,
      { headers, signal },
    );
    if (response.status === 202) {
      const wait = 1_500 * (attempt + 1);
      if (Date.now() + wait > deadline - COMMITS_RESERVE_MS) break;
      await sleep(wait);
      continue;
    }
    const body = (await response.json().catch(() => null)) as ContributorStat[] | null;
    if (!response.ok || !Array.isArray(body)) {
      console.error("[github-repo]", response.status, "仓库统计响应不是预期的形状");
      break;
    }
    return summarizeRepoStats(body, owner, name, Date.now());
  }

  console.warn("[github-repo] stats 未就绪，改用 commits 回退");
  return fetchRepoStatsFromCommits(owner, name, headers, signal);
}

type CommitListItem = {
  sha?: string;
  commit?: { author?: { date?: string } | null } | null;
  author?: { login?: string; avatar_url?: string } | null;
};

/** 周日 00:00 UTC 的 epoch 秒，对齐 GitHub stats 的 `w`。 */
function weekStartSeconds(iso: string): number | null {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(weekStartMs(ms) / 1000);
}

/**
 * 用最近若干页 commit 拼每人每周的 commit 数。增删行拿不到，记 0。
 * 只覆盖能翻到的窗口，够画卡片；完整历史仍以 stats 为准。
 * 共用外层的 signal：预算耗尽时这里的 fetch 一起中止。
 */
async function fetchRepoStatsFromCommits(
  owner: string,
  name: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<GithubRepoPayload> {
  const since = new Date(Date.now() - WEEK_WINDOW * WEEK_MS).toISOString();
  const byLogin = new Map<
    string,
    { avatarUrl: string | null; weeks: Map<number, number> }
  >();

  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(`https://api.github.com/repos/${owner}/${name}/commits`);
    url.searchParams.set("since", since);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers, signal });
    const body = (await response.json().catch(() => null)) as CommitListItem[] | null;
    if (!response.ok || !Array.isArray(body)) {
      console.error("[github-repo]", response.status, "commits 回退响应不是预期的形状");
      throw new Error("GitHub 仓库统计取数失败");
    }
    if (body.length === 0) break;
    for (const item of body) {
      const login = item.author?.login?.trim() || "ghost";
      const week = item.commit?.author?.date ? weekStartSeconds(item.commit.author.date) : null;
      if (week == null) continue;
      const row = byLogin.get(login) ?? {
        avatarUrl: item.author?.avatar_url ?? null,
        weeks: new Map<number, number>(),
      };
      if (!row.avatarUrl && item.author?.avatar_url) row.avatarUrl = item.author.avatar_url;
      row.weeks.set(week, (row.weeks.get(week) ?? 0) + 1);
      byLogin.set(login, row);
    }
    if (body.length < 100) break;
  }

  const raw: ContributorStat[] = [...byLogin.entries()].map(([login, row]) => ({
    author: { login, avatar_url: row.avatarUrl ?? undefined },
    total: [...row.weeks.values()].reduce((sum, n) => sum + n, 0),
    weeks: [...row.weeks.entries()].map(([w, c]) => ({ w, a: 0, d: 0, c })),
  }));

  if (raw.length === 0) throw new Error("GitHub 仓库统计取数失败");
  return summarizeRepoStats(raw, owner, name, Date.now());
}
