import { cached } from "@/lib/cache";
import { formatContributionLabel, groupWeeks } from "@/lib/github-chart-compact";
import { site } from "@/lib/site";
import type { GithubChartDay, GithubChartPayload } from "@/lib/types";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/**
 * 缓存这份日历。
 *
 * 其余状态源的 `live` 那半读的都是本地 Redis，只有这条真的出网。
 * STATUS_CACHE 关掉的部署上（见 lib/api）端点走的正是 `live`，于是每一次匿名
 * GET /api/status/github-chart 都等于一次 GitHub GraphQL 调用 —— 端点不鉴权、
 * 响应又是 no-store，CDN 也不兜底，几十 rps 就能把令牌那 5000 points/hour
 * 打空，而这把令牌按注释必须是权限很宽的 classic PAT。
 *
 * TTL 取 STATUS_LIFE.revalidate 的同量级（10 分钟）：浏览器侧本来 6 小时才轮
 * 一次，这个窗口对正常负载毫无影响，挡的是攻击面。lib/cache 顺带给了进程内
 * in-flight 去重和 5 秒负缓存，`cached` / `live` 两条路一起被保护。
 */
const CHART_CACHE_KEY = "github-chart:v1";
const CHART_TTL_MS = 10 * 60_000;

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

function scoreOf(level: string | undefined): GithubChartDay["score"] | null {
  if (!level || !(level in LEVEL_SCORE)) return null;
  return LEVEL_SCORE[level as ContributionLevel];
}

function mapDays(payload: CalendarPayload): GithubChartDay[] | null {
  const weeks = payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks?.length) return null;

  const days: GithubChartDay[] = [];
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      if (!day.date || typeof day.weekday !== "number") return null;
      const score = scoreOf(day.contributionLevel);
      if (score == null) return null;
      const count = Number(day.contributionCount) || 0;
      days.push({
        date: day.date,
        weekday: day.weekday,
        count,
        score,
        label: formatContributionLabel(day.date, count),
      });
    }
  }
  return days.length ? days : null;
}

/**
 * 用 GraphQL 拉过去一年的贡献日历。
 *
 * token 见 GITHUB_TOKEN。Fine-grained 个人令牌看不见组织仓，classic 才能和
 * 资料页对上。没配则返回空周，联系卡片不画这栏；GitHub 挂了要抛出去，
 * 交给 statusEnvelope 变成 ok:false，轮询那轮才不会把上一张好图盖掉。
 *
 * 没配令牌时连缓存都不进：空周是个常量，为它去问一次 Redis 是白问的。
 */
export async function getGithubChart(): Promise<GithubChartPayload> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { weeks: [] };

  return cached(CHART_CACHE_KEY, CHART_TTL_MS, () => fetchGithubChart(token));
}

async function fetchGithubChart(token: string): Promise<GithubChartPayload> {
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

  const days = mapDays(body);
  if (!days) throw new Error("GitHub 贡献日历是空的");
  return { weeks: groupWeeks(days) };
}
