import { cached, get, put } from "@/lib/cache";
import { site } from "@/lib/site";
import type { GithubRepoContributor, GithubRepoPayload } from "@/lib/types";

/**
 * 本仓库的贡献统计。名单走 GitHub REST `/stats/contributors`，顶部那三个总数
 * 另走 GraphQL —— 这两件事在 GitHub 那边不是一回事，见下面 fetchRepoTotals。
 *
 * 和贡献日历同一条流程：Worker 取数进 SQLite TTL 缓存，进 `/api/home` 快照，
 * 也有 `/api/status/github-repo` 给浏览器按长间隔轮询；没有推送。
 *
 * token 复用 Worker 上的 GITHUB_TOKEN（和贡献日历同一把）：名单那半公开仓不带
 * token 也能读，只是匿名限额低（每 IP 60 次/小时）；总数那半是 GraphQL，没有
 * token 就取不到，三个数字显示「—」。
 */

/** 形状变过就要换键，不然旧窗口那份还会活满一个 TTL。v5 起不再有 weeks。 */
const REPO_STATS_CACHE_KEY = "github-repo:v5";
const REPO_STATS_TTL_MS = 30 * 60_000;

/**
 * 最近一次成功的结果，另存一份、活得久。
 *
 * 每次 push 后 GitHub 会作废统计缓存重新排队现算，期间一直回 202，一轮从
 * 30 秒到几分钟都有；30 分钟 TTL 到期恰好撞上这段窗口时，拿这份顶上，
 * 卡片不会因为 GitHub 在算就消失。顶上的那份照样按 30 分钟缓存，下一轮再试。
 *
 * **键名不带版本**：撞上 202 窗口的恰恰是「刚 push 完」，也就是刚换了新版本的
 * 那一刻。跟着 payload 形状换键等于在最需要它的时候把这条退路清空 ——
 * 改形状后第一次部署，卡片会整个消失几分钟（2026-09-14 就这么翻过一次）。
 * 多出来的旧字段读的人本来就不看，缺字段按可选处理。
 */
const LAST_GOOD_KEY = "github-repo:last-good";
const LAST_GOOD_TTL_MS = 7 * 86_400_000;

/**
 * 增删行的累计锚：`oid` 这条提交连同它全部祖先的增删行总和。
 *
 * 这份要能跨部署活着 —— 它替掉的是一次从 HEAD 走到根的全量翻页。锚在就只需
 * 补上「锚之后的那几条」，稳态下一页搞定；锚过期才重新全量走一次。
 */
const CHURN_ANCHOR_KEY = "github-repo:churn";
const CHURN_ANCHOR_TTL_MS = 30 * 86_400_000;

/**
 * 整次取数的总预算，含等 202 的时间。
 *
 * 这一路挂在 `/api/home` 的 Promise.all 里，而站点聚合请求 20 秒就会掐掉
 * 整个快照；不设上限就是让一张卡拖垮整个首页重建。名单和总数两路并发跑，
 * 各自在这个 deadline 前收手。
 */
const FETCH_BUDGET_MS = 12_000;

/** 等 202 的轮询间隔：GitHub 的说法是「过一会儿再来」。 */
const RETRY_INTERVAL_MS = 3_000;

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/** 一页翻多少条提交，GraphQL `history` 的上限就是 100。 */
const HISTORY_PAGE = 100;

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

/** 全仓总数。取不到就是 null，卡片显示「—」，不拿错的数字顶上。 */
export type RepoTotals = {
  commits: number | null;
  additions: number | null;
  deletions: number | null;
};

const NO_TOTALS: RepoTotals = { commits: null, additions: null, deletions: null };

type ChurnAnchor = {
  /** 默认分支上的一条提交 */
  oid: string;
  /** 它连同全部祖先的增删行累计 */
  additions: number;
  deletions: number;
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
 * 把 `/stats/contributors` 的原始返回汇总成名单。纯函数，不碰网络，方便单测。
 *
 * `totals` 单独传进来，**不是**把名单加起来 —— 见 fetchRepoTotals 的注释：
 * 这个仓 434 条提交里有 403 条带 `Co-authored-by`，加起来会得到 811。
 */
export function summarizeRepoStats(
  raw: ContributorStat[],
  owner: string,
  name: string,
  now: number,
  totals: RepoTotals = NO_TOTALS,
): GithubRepoPayload {
  const contributors: GithubRepoContributor[] = raw.map((entry) => {
    let additions = 0;
    let deletions = 0;
    for (const week of Array.isArray(entry.weeks) ? entry.weeks : []) {
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

  return {
    repo: `${owner}/${name}`,
    fetchedAt: now,
    totals: { ...totals, contributors: contributors.length },
    contributors,
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
      // 名单没取到不代表总数也没取到 —— 它们是两个接口。这轮算出来的总数照样
      // 是新的，只有名单是旧的：顶部三个数字不必跟着名单一起陈旧。
      const totals = error instanceof ContributorsUnavailable ? error.totals : NO_TOTALS;
      if (totals.commits == null) return lastGood;
      return {
        ...lastGood,
        totals: { ...totals, contributors: lastGood.totals.contributors },
      };
    }
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 取数本体，不碰缓存层。名单和总数两路并发，共用一个 deadline 和一个 signal。
 *
 * 名单取不到就抛出去（由 getGithubRepo 决定用上一次成功的顶上）；总数取不到
 * 只是三个数字变「—」，不牵连名单 —— 它们是两个接口、两种失败方式。
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

  const [listed, totals] = await Promise.all([
    fetchContributorStats(headers, signal, deadline, owner, name).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    fetchRepoTotals(token, owner, name, signal, deadline).catch((error: unknown) => {
      console.warn(
        "[github-repo]",
        error instanceof Error ? error.message : String(error),
        "；这轮不显示总数",
      );
      return NO_TOTALS;
    }),
  ]);
  if (!listed.ok) {
    const message =
      listed.error instanceof Error ? listed.error.message : String(listed.error);
    throw new ContributorsUnavailable(message, totals);
  }
  return summarizeRepoStats(listed.value, owner, name, Date.now(), totals);
}

/** 名单这一路没取到，但同一轮算出来的总数还在，交给 getGithubRepo 拼进 last-good。 */
class ContributorsUnavailable extends Error {
  // 构造参数属性在 node --experimental-strip-types 下会直接报语法错，写成普通字段
  totals: RepoTotals;

  constructor(message: string, totals: RepoTotals) {
    super(message);
    this.name = "ContributorsUnavailable";
    this.totals = totals;
  }
}

/**
 * 名单那半：`/stats/contributors`，GitHub 现算时回 202，就每 3 秒再问一次。
 * 预算内等不到、或响应不对，都抛出去 —— 没有 commits 列表那种退路：
 * 它拼不出增删行，「+0 / −0」会在缓存里挂半小时。
 */
async function fetchContributorStats(
  headers: Record<string, string>,
  signal: AbortSignal,
  deadline: number,
  owner: string,
  name: string,
): Promise<ContributorStat[]> {
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
    return body;
  }
}

type GraphqlHistoryNode = { oid?: string; additions?: number; deletions?: number };

type GraphqlPayload = {
  data?: {
    repository?: {
      defaultBranchRef?: {
        target?: {
          oid?: string;
          history?: {
            totalCount?: number;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
            nodes?: GraphqlHistoryNode[];
          };
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

async function graphql(
  token: string,
  signal: AbortSignal,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphqlPayload["data"]> {
  const response = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "lyjwpage",
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as GraphqlPayload | null;
  if (!response.ok || !body?.data || body.errors?.length) {
    // 上游原文只进日志：GitHub 的报错里可能带令牌状态、配额、组织名这类不该
    // 出门的东西，而这条 message 会经 statusEnvelope 原样变成公开 JSON。
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    console.error("[github-repo]", response.status, reason || "GraphQL 响应不是预期的形状");
    throw new Error("GitHub 仓库总数取数失败");
  }
  return body.data;
}

const HEAD_QUERY = `query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { oid ... on Commit { history { totalCount } } } }
  }
}`;

const HISTORY_QUERY = `query ($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(first: ${HISTORY_PAGE}, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { oid additions deletions }
          }
        }
      }
    }
  }
}`;

/**
 * 顶部那三个总数：默认分支的提交数与全仓增删行。
 *
 * **不能把名单加起来。** `/stats/contributors` 是「贡献」而不是「提交归属」：
 * 一条带 `Co-authored-by` 的提交会整条记在作者名下，也整条记在每位协作者名下，
 * 增删行同样各记一遍。这个仓 434 条提交里 403 条是「我 + agent」的形式，于是
 * 加总得到 811 次提交、+239386/−96550 行，都是真实值的两倍左右
 * （真值 434 / +121476 / −44421，与 `git rev-list --count`、`git log --numstat` 一致）。
 *
 * 提交数用 GraphQL 的 `history.totalCount`，一次请求就精确。增删行没有现成的
 * 全仓字段：`/stats/code_frequency` 本来正合适，但这个仓上它长期只回 202
 * （带令牌试了二十来次都没算出来），所以只能自己把 history 翻一遍求和 ——
 * 代价是每 100 条提交一次请求，所以结果锚在 HEAD 上存起来，之后每轮只补新增
 * 的那几条。锚还在、HEAD 没动，就一次请求都不用翻。
 *
 * 预算内翻不完：提交数照样返回（它只要一次请求），增删行退回锚上那份 ——
 * 顶多旧几条提交，下一轮继续往前推；连锚都没有就是 null，显示「—」。
 */
async function fetchRepoTotals(
  token: string | null,
  owner: string,
  name: string,
  signal: AbortSignal,
  deadline: number,
): Promise<RepoTotals> {
  if (!token) return NO_TOTALS;

  const head = await graphql(token, signal, HEAD_QUERY, { owner, name });
  const target = head?.repository?.defaultBranchRef?.target;
  const headOid = target?.oid?.trim() || "";
  const commits = typeof target?.history?.totalCount === "number" ? target.history.totalCount : null;
  if (!headOid) return { commits, additions: null, deletions: null };

  const anchor = await get<ChurnAnchor>(CHURN_ANCHOR_KEY);
  if (anchor?.oid === headOid) {
    return { commits, additions: anchor.additions, deletions: anchor.deletions };
  }

  let additions = 0;
  let deletions = 0;
  let cursor: string | null = null;
  for (;;) {
    if (Date.now() >= deadline) {
      // 翻不完就别写锚：这份和式缺尾巴，落盘会把它当成「到根为止」。
      return { commits, additions: anchor?.additions ?? null, deletions: anchor?.deletions ?? null };
    }
    const page: GraphqlPayload["data"] = await graphql(token, signal, HISTORY_QUERY, {
      owner,
      name,
      cursor,
    });
    const history = page?.repository?.defaultBranchRef?.target?.history;
    const nodes = history?.nodes ?? [];
    for (const node of nodes) {
      // 锚那条连同它的祖先已经在 anchor 的和里了，到此为止。
      if (anchor && node.oid === anchor.oid) {
        return finishChurn(headOid, additions + anchor.additions, deletions + anchor.deletions, commits);
      }
      additions += numberOrZero(node.additions);
      deletions += numberOrZero(node.deletions);
    }
    // 锚不在这条链上（rebase / force push 把它冲掉了）也不用特判：
    // 一路翻到根，手里这份和式本身就是完整的。
    if (!history?.pageInfo?.hasNextPage) {
      return finishChurn(headOid, additions, deletions, commits);
    }
    cursor = history.pageInfo.endCursor ?? null;
    if (!cursor) return finishChurn(headOid, additions, deletions, commits);
  }
}

async function finishChurn(
  oid: string,
  additions: number,
  deletions: number,
  commits: number | null,
): Promise<RepoTotals> {
  await put<ChurnAnchor>(CHURN_ANCHOR_KEY, { oid, additions, deletions }, CHURN_ANCHOR_TTL_MS);
  return { commits, additions, deletions };
}
