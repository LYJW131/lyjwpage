import { heatmapSliceFrom, sliceHeatmapWindow } from "@/lib/heatmap-window";
import { loadLag, type LagResult } from "@/lib/lag-result";
import { site } from "@/lib/site";
import type { GithubChartPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

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
          }
        }
      }
    }
  }
}`;

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
            }>;
          }>;
        };
      };
    };
  };
  errors?: Array<{ message?: string }>;
};

function mapDays(payload: CalendarPayload): GithubChartPayload | null {
  const weeks = payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks?.length) return null;

  const counts: number[] = [];
  let origin = "";
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      if (!day.date || typeof day.weekday !== "number") return null;
      if (!origin) origin = day.date;
      counts.push(Number(day.contributionCount) || 0);
    }
  }
  return origin && counts.length ? { origin, counts } : null;
}

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
    return { origin: payload.origin, counts: payload.counts };
  }
  return {
    origin: payload.origin,
    counts: payload.counts.slice(fromIndex),
    countsPartial: true,
    from: heatmapSliceFrom(payload.origin, fromIndex),
  };
}

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
    const reason = body?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    console.error("[github-chart]", response.status, reason || "响应不是预期的形状");
    throw new Error("GitHub 贡献日历取数失败");
  }

  const chart = mapDays(body);
  if (!chart) throw new Error("GitHub 贡献日历是空的");
  return chart;
}
