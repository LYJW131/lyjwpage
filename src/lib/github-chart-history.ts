import { expandGithubDays, formatContributionLabel, groupWeeks, heatmapFrame, weekdayOf } from "@/lib/github-chart-compact";
import { heatmapRefreshFrom, mergeHeatmapSeries } from "@/lib/heatmap-window";
import type { GithubChartDay, GithubChartPayload } from "@/lib/types";


let snapshot: GithubChartPayload | null = null;

export function githubChartCursor(): string | null {
  return snapshot ? heatmapRefreshFrom(snapshot.origin, snapshot.counts.length) : null;
}

export function seedGithubChart(payload: GithubChartPayload): void {
  if (snapshot?.counts.length || payload.countsPartial) return;
  snapshot = {
    origin: payload.origin,
    counts: payload.counts.slice(),
  };
}

export function mergeGithubChart(payload: GithubChartPayload): GithubChartPayload {
  if (!payload.countsPartial || !snapshot?.counts.length) {
    snapshot = {
      origin: payload.origin,
      counts: payload.counts.slice(),
      };
    return snapshot;
  }

  const counts = mergeHeatmapSeries(snapshot.counts, snapshot.origin, {
    origin: payload.origin,
    from: payload.from,
    values: payload.counts,
    partial: true,
  });
  snapshot = { origin: counts.origin, counts: counts.values };
  return snapshot;
}

export function githubChartWeeks(payload: GithubChartPayload, today: string | null = null): GithubChartDay[][] {
  const days = expandGithubDays(payload.origin, payload.counts);
  const last = days.at(-1)?.date;
  const through = today && (!last || today > last) ? today : last;
  if (!through) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  return groupWeeks(heatmapFrame(through).map((date) => byDate.get(date) ?? {
    date,
    weekday: weekdayOf(date),
    count: 0,
    score: 0,
    label: formatContributionLabel(date, 0),
  }));
}
