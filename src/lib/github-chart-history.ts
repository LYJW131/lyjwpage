import { expandGithubDays, formatContributionLabel, groupWeeks, heatmapFrame, weekdayOf } from "@/lib/github-chart-compact";
import { heatmapRefreshFrom, mergeHeatmapSeries } from "@/lib/heatmap-window";
import type { GithubChartDay, GithubChartPayload } from "@/lib/types";

/**
 * 贡献热力图的客户端累加器。和充电头曲线同一套：模块级一份，轮询 / 切回焦点
 * 共用游标，SWR 的键仍是路径本身。
 */

let snapshot: GithubChartPayload | null = null;

/** 已有窗口里今天起的第一天；空窗口返回 null 表示要整份 */
export function githubChartCursor(): string | null {
  return snapshot ? heatmapRefreshFrom(snapshot.origin, snapshot.counts.length) : null;
}

export function seedGithubChart(payload: GithubChartPayload): void {
  if (snapshot?.counts.length || payload.countsPartial) return;
  snapshot = {
    origin: payload.origin,
    counts: payload.counts.slice(),
    scores: payload.scores.slice(),
  };
}

export function mergeGithubChart(payload: GithubChartPayload): GithubChartPayload {
  if (!payload.countsPartial || !snapshot?.counts.length) {
    snapshot = {
      origin: payload.origin,
      counts: payload.counts.slice(),
      scores: payload.scores.slice(),
    };
    return snapshot;
  }

  const counts = mergeHeatmapSeries(snapshot.counts, snapshot.origin, {
    origin: payload.origin,
    from: payload.from,
    values: payload.counts,
    partial: true,
  });
  const scores = mergeHeatmapSeries(snapshot.scores, snapshot.origin, {
    origin: payload.origin,
    from: payload.from,
    values: payload.scores,
    partial: true,
  });
  snapshot = {
    origin: counts.origin,
    counts: counts.values,
    scores: scores.values as GithubChartPayload["scores"],
  };
  return snapshot;
}

/**
 * 画到 `today` 与数据最后一天里较晚的那天（窗口见 heatmapFrame）。`today` 由浏览器按
 * 站点时区算：跨过零点那一刻新的一格就出来，不等采集 Worker 和下一次轮询；首帧没有
 * 钟时传 null，按数据画。
 */
export function githubChartWeeks(payload: GithubChartPayload, today: string | null = null): GithubChartDay[][] {
  const days = expandGithubDays(payload.origin, payload.counts, payload.scores);
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
