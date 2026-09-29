import { heatmapSliceFrom, sliceHeatmapWindow } from "@/lib/heatmap-window";
import { loadLag, type LagResult } from "@/lib/lag-result";
import { site } from "@/lib/site";
import type { GithubChartPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/**
 * 贡献日历。拉取在采集 Worker（`githubChartJob`），整年一份写进可滞后层；
 * 公开端点只读那一份，`?since=` 的切片在读取这一侧做。令牌只在采集 Worker 上。
 *
 * 信封是 origin + 日序列，和年度 token 同一形状。逐日的 date / weekday / label
 * 浏览器现算；GitHub 的四分位不能在这边重算，所以 scores 跟着走。
 */
const CALENDAR_QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            weekday
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

const LEVEL_SCORE = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
} as const;

type ContributionLevel = keyof typeof LEVEL_SCORE;

type CalendarPayload = {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: Array<{
            contributionDays?: Array<{
              date?: string;
              weekday?: number;
              contributionCount?: number;
              contributionLevel?: string;
            }>;
          }>;
        };
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

function scoreOf(level: string | undefined): GithubChartPayload["scores"][number] | null {
  if (!level || !(level in LEVEL_SCORE)) return null;
  return LEVEL_SCORE[level as ContributionLevel];
}

function mapDays(payload: CalendarPayload): GithubChartPayload | null {
  const weeks = payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks?.length) return null;

  const counts: number[] = [];
  const scores: GithubChartPayload["scores"] = [];
  let origin = "";
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      if (!day.date || typeof day.weekday !== "number") return null;
      const score = scoreOf(day.contributionLevel);
      if (score == null) return null;
      if (!origin) origin = day.date;
      counts.push(Number(day.contributionCount) || 0);
      scores.push(score);
    }
  }
  return origin && counts.length ? { origin, counts, scores } : null;
}

/** 公开端点：可滞后层里的整年日历；还没写过就是等采集 */
export function getGithubChart(): Promise<LagResult<GithubChartPayload>> {
  return loadLag<GithubChartPayload>(LAG_KEYS.githubChart, "Waiting for the first contribution calendar");
}

export function sliceGithubChart(
  payload: GithubChartPayload,
  since?: string,
): GithubChartPayload {
  const { partial, fromIndex } = sliceHeatmapWindow(
    payload.origin,
    payload.counts.length,
    since,
  );
  if (!partial) {
    return { origin: payload.origin, counts: payload.counts, scores: payload.scores };
  }
  return {
    origin: payload.origin,
    counts: payload.counts.slice(fromIndex),
    scores: payload.scores.slice(fromIndex),
    countsPartial: true,
    from: heatmapSliceFrom(payload.origin, fromIndex),
  };
}

/**
 * 用 GraphQL 拉过去一年的贡献日历（采集 Worker 调）。
 *
 * Fine-grained 个人令牌看不见组织仓，classic 才能和资料页对上。GitHub 挂了就抛，
 * 采集那一轮不写，可滞后层里上一张好图原样留着。
 */
export async function fetchGithubChart(token: string): Promise<GithubChartPayload> {
  const response = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "lyjwpage",
    },
    body: JSON.stringify({
      query: CALENDAR_QUERY,
      variables: { login: site.githubLogin },
    }),
    signal: AbortSignal.timeout(8_000),
  });

  const body = (await response.json().catch(() => null)) as CalendarPayload | null;
  if (!response.ok || !body || body.errors?.length) {
    /**
     * 上游原文只进日志。这条 message 会经 statusEnvelope 原样变成公开 JSON 里的
     * `error`，而 GitHub 的报错里可能带令牌状态、配额、组织名这类不该出门的东西。
     * 页面只需要知道「这栏这轮没取到」，详情留给服务端日志。
     */
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    console.error("[github-chart]", response.status, reason || "响应不是预期的形状");
    throw new Error("GitHub 贡献日历取数失败");
  }

  const chart = mapDays(body);
  if (!chart) throw new Error("GitHub 贡献日历是空的");
  return chart;
}
