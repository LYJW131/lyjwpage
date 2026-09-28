"use client";

import { useMemo, useState } from "react";

import {
  HeatmapGrid,
  HeatmapTooltip,
  cellAnchor,
  useHeatmapOpen,
  type CellAnchor,
} from "@/components/live/heatmap-hover";
import { useSiteDay } from "@/hooks/use-site-day";
import { useStale } from "@/hooks/use-stale";
import { incrementalFetcher, useStatus } from "@/hooks/use-status";
import { GITHUB_CHART_STALE_MS } from "@/lib/freshness";
import {
  githubChartCursor,
  githubChartWeeks,
  mergeGithubChart,
  seedGithubChart,
} from "@/lib/github-chart-history";
import { GITHUB_CHART_PATH } from "@/lib/paths";
import type { GithubChartDay, GithubChartPayload, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 贡献日历按天变，带游标只拉窗尾，一小时一轮很便宜。间隔要明显短于过期阈值
 * （GITHUB_CHART_STALE_MS，6 小时），否则正常的页面也会在下一轮之前先翻成 Unavailable。
 */
const REFRESH_MS = 60 * 60_000;

const fetchGithubChart = incrementalFetcher<GithubChartPayload>(
  githubChartCursor,
  mergeGithubChart,
);

type HoveredCell = {
  date: string;
  count: number;
  anchor: CellAnchor;
};

export function GithubChart({ fallback }: { fallback: StatusResponse<GithubChartPayload> }) {
  const { data, updatedAt, servedAt } = useStatus<GithubChartPayload>(GITHUB_CHART_PATH, REFRESH_MS, {
    fallback,
    fetcher: fetchGithubChart,
    seedFallback: seedGithubChart,
    // 首屏已经烧进去：可滞后层的挂载策略只在首屏那份超过一个轮询间隔时才补取。
    // 切回标签页时拉一次，长轮询仍作兜底。
    revalidateOnFocus: true,
  });
  /**
   * 采集 Worker 每 10 分钟拉一次；超过阈值就把整张图压淡、标 Unavailable，不拿旧日历冒充今天。
   * 首帧拿首屏信封的 servedAt 当钟，放久了的 HTML 首帧就是 Unavailable，不等挂载再翻。
   */
  const stale = useStale(
    updatedAt ?? (fallback.ok ? fallback.updatedAt : undefined),
    GITHUB_CHART_STALE_MS,
    servedAt,
  );
  /**
   * 留住上一份画得出来的日历，轮询在飞的时候别让图表闪空。
   *
   * 降级信封（ok:false）是一次成功的请求，SWR 照样把它写进缓存 ——
   * keepPreviousData 只在换键时兜底，兜不住这条；useStatus 再把它翻成
   * data: undefined，于是图表整块消失，要等下一轮才回来。
   *
   * 渲染期直接调整 state，不用 ref 也不放 useEffect：ref 在渲染期读写是
   * React 明令禁止的（写了也不保证重渲染），effect 要多渲染一轮、中间那帧
   * 照样是空的。
   */
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.counts.length && data !== lastDrawn) setLastDrawn(data);
  const snapshot = data?.counts.length ? data : lastDrawn;
  // 格子画到浏览器的今天：跨过零点新的一格就出来，数就等采集 Worker 和下一次轮询填
  const today = useSiteDay();
  const { svgRef, shown, hotDate, previewCell, clearPreview, togglePin } =
    useHeatmapOpen<HoveredCell>();

  const weeks = useMemo(
    () => (snapshot?.counts.length ? githubChartWeeks(snapshot, today) : null),
    [snapshot, today],
  );

  if (!weeks?.length) return null;

  const cellOf = (day: GithubChartDay, target: Element): HoveredCell => ({
    date: day.date,
    count: day.count,
    anchor: cellAnchor(target),
  });

  return (
    <div className="github-chart relative w-full">
      {stale && (
        <span className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground">
          Unavailable
        </span>
      )}
      <div className={cn(stale && "opacity-30")} aria-hidden={stale || undefined}>
        <HeatmapGrid
          svgRef={svgRef}
          weeks={weeks}
          hotDate={hotDate}
          label="GitHub contribution heatmap"
          onCellPreview={(day, target) => previewCell(cellOf(day, target))}
          onCellClear={clearPreview}
          onCellToggle={(day, target) => togglePin(cellOf(day, target))}
        />
      </div>
      {shown && (
        <HeatmapTooltip
          date={shown.date}
          value={String(shown.count)}
          unit="Commit"
          anchor={shown.anchor}
        />
      )}
    </div>
  );
}
