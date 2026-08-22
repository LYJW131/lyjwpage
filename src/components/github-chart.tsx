"use client";

import { useState } from "react";

import {
  HeatmapGrid,
  HeatmapTooltip,
  cellAnchor,
  useHeatmapOpen,
  type CellAnchor,
} from "@/components/live/heatmap-hover";
import { useStatus } from "@/hooks/use-status";
import { FILLS } from "@/lib/github-chart-compact";
import { GITHUB_CHART_PATH } from "@/lib/paths";
import type { GithubChartDay, GithubChartPayload, StatusResponse } from "@/lib/types";

/** 贡献日历按天变。长间隔兜底就够，别跟状态卡抢请求。 */
const REFRESH_MS = 6 * 60 * 60_000;

type HoveredCell = {
  date: string;
  count: number;
  anchor: CellAnchor;
};

export function GithubChart({ fallback }: { fallback: StatusResponse<GithubChartPayload> }) {
  const { data } = useStatus<GithubChartPayload>(GITHUB_CHART_PATH, REFRESH_MS, {
    fallback,
    // 首屏已经烧进去。进页时的 focus 也会触发回源，两边都关，只留上面的长轮询。
    revalidateOnMount: false,
    revalidateOnFocus: false,
  });
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
  if (data?.weeks.length && data !== lastDrawn) setLastDrawn(data);
  const weeks = data?.weeks ?? lastDrawn?.weeks;
  const { svgRef, shown, hotDate, previewCell, clearPreview, togglePin } =
    useHeatmapOpen<HoveredCell>();

  if (!weeks?.length) return null;

  const cellOf = (day: GithubChartDay, target: Element): HoveredCell => ({
    date: day.date,
    count: day.count,
    anchor: cellAnchor(target),
  });

  return (
    <div className="github-chart w-full">
      <HeatmapGrid
        svgRef={svgRef}
        weeks={weeks}
        fills={FILLS}
        hotDate={hotDate}
        label="GitHub contribution heatmap"
        onCellPreview={(day, target) => previewCell(cellOf(day, target))}
        onCellClear={clearPreview}
        onCellToggle={(day, target) => togglePin(cellOf(day, target))}
      />
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
