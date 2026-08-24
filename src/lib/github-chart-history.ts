import { expandGithubDays, groupWeeks } from "@/lib/github-chart-compact";
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

export function githubChartWeeks(payload: GithubChartPayload): GithubChartDay[][] {
  return groupWeeks(expandGithubDays(payload.origin, payload.counts, payload.scores));
}
