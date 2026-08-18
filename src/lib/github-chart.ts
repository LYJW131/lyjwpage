import { formatContributionLabel, groupWeeks } from "@/lib/github-chart-compact";
import { site } from "@/lib/site";
import type { GithubChartDay, GithubChartPayload } from "@/lib/types";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

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
 */
export async function getGithubChart(): Promise<GithubChartPayload> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { weeks: [] };

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
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`GitHub GraphQL ${response.status}${reason ? `：${reason}` : ""}`);
  }

  const days = mapDays(body);
  if (!days) throw new Error("GitHub 贡献日历是空的");
  return { weeks: groupWeeks(days) };
}
