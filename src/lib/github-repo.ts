import { get, put } from "@/lib/cache";
import { loadLag, type LagResult } from "@/lib/lag-result";
import { site } from "@/lib/site";
import type { GithubRepoContributor, GithubRepoPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";


const CHURN_ANCHOR_KEY = "github-repo:churn";
const CHURN_ANCHOR_TTL_MS = 30 * 86_400_000;

const FETCH_BUDGET_MS = 12_000;

const RETRY_INTERVAL_MS = 3_000;

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

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

export type RepoTotals = {
  commits: number | null;
  additions: number | null;
  deletions: number | null;
};

const NO_TOTALS: RepoTotals = { commits: null, additions: null, deletions: null };

type ChurnAnchor = {
  oid: string;
  additions: number;
  deletions: number;
};

export function repoIdFromUrl(url: string): { owner: string; name: string } {
  const match = /github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (match?.[1] && match?.[2]) return { owner: match[1], name: match[2] };
  return { owner: site.githubLogin, name: "lyjwpage" };
}

const numberOrZero = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

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

export function getGithubRepo(): Promise<LagResult<GithubRepoPayload>> {
  return loadLag<GithubRepoPayload>(LAG_KEYS.githubRepo, "Waiting for the first repository stats");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

export class ContributorsUnavailable extends Error {
  // 构造参数属性在 node --experimental-strip-types 下会直接报语法错，写成普通字段
  totals: RepoTotals;

  constructor(message: string, totals: RepoTotals) {
    super(message);
    this.name = "ContributorsUnavailable";
    this.totals = totals;
  }
}

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

// contributors 会把同一提交计入每位协作者；总数必须独立计算，不能按贡献者相加。
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
      if (anchor && node.oid === anchor.oid) {
        return finishChurn(headOid, additions + anchor.additions, deletions + anchor.deletions, commits);
      }
      additions += numberOrZero(node.additions);
      deletions += numberOrZero(node.deletions);
    }
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
