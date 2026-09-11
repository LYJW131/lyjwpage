import { site } from "@/lib/site";
import type {
  GithubRepoContributor,
  GithubRepoPayload,
  GithubRepoWeek,
} from "@/lib/types";

/**
 * 本仓库的贡献统计，走 GitHub REST `/stats/contributors`。
 *
 * 这份不是实时状态：仓库有新提交就意味着一次新部署，统计只在构建期取一次、
 * 焊进 HTML 就够了（见 `github-repo-site.ts`），不经 Worker、没有状态端点、
 * 浏览器不轮询。这个文件只放纯逻辑和取数，不碰 next/cache，单测直接跑。
 *
 * token 用 Vercel 上的 GITHUB_TOKEN：公开仓不带 token 也能读，只是匿名限额低
 * （每 IP 60 次/小时，构建机的出口 IP 是共用的），有就带上。
 *
 * 这路和贡献日历的区别：日历是 GraphQL 按人拉全年、由 Worker 常驻刷新；
 * 统计是 REST 按仓拉每周、一次构建一份。
 */

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
 * 每次部署本身就是一次 push，GitHub 会把这个仓的统计缓存作废、重新排队现算，
 * 所以构建期几乎总会先撞上 202；实测这个仓一轮要 30 秒上下。构建期填
 * `use cache` 的上限是 50 秒，40 秒尽量把这一轮等完、又不顶到那条线；
 * 运行期后台重建走 Vercel 函数，默认时限远大于此。预算内等不到就抛：
 * 结果一旦进缓存就冻到下次部署，宁可这轮不画也不能把残缺的数据焊进去。
 */
const FETCH_BUDGET_MS = 40_000;

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取数本体；不碰缓存层，缓存由 `github-repo-site.ts` 的 `use cache` 负责。
 *
 * 只认 `/stats/contributors`（带每人每周 a/d/c）。GitHub 现算时回 202，
 * 就按 1.5s、3s、4.5s… 退避重试；整次不超过 budgetMs，一个共享的 AbortSignal
 * 挂在所有 fetch 上。预算内等不到、或响应不对，都抛出去 —— 没有 commits
 * 列表那种退路：它拼不出增删行，「+0 / −0」焊进 HTML 会一直挂到下次部署。
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
    // Next 在同一次渲染里会把 URL 相同的 GET 记忆化，重试会一直拿到第一次那个
    // 202；每轮换个查询参数把它区分开。GitHub 不认这个参数，行为不变。
    url.searchParams.set("attempt", String(attempt));
    const response = await fetch(url, { headers, cache: "no-store", signal });
    if (response.status === 202) {
      const wait = 1_500 * (attempt + 1);
      if (Date.now() + wait > deadline) {
        throw new Error("GitHub 仓库统计尚未就绪（连续 202），这轮不画");
      }
      await sleep(wait);
      continue;
    }
    const body = (await response.json().catch(() => null)) as ContributorStat[] | null;
    if (!response.ok || !Array.isArray(body)) {
      throw new Error(`GitHub 仓库统计响应不是预期的形状（HTTP ${response.status}）`);
    }
    return summarizeRepoStats(body, owner, name, Date.now());
  }
}
