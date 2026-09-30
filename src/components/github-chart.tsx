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
  const { data, updatedAt, servedAt } = useStatus<GithubChartPayload>(GITHUB_CHART_PATH, {
    fallback,
    fetcher: fetchGithubChart,
    seedFallback: seedGithubChart,
    revalidateOnFocus: true,
  });
  const stale = useStale(
    updatedAt ?? (fallback.ok ? fallback.updatedAt : undefined),
    GITHUB_CHART_STALE_MS,
    servedAt,
  );
  // SWR keepPreviousData 只兜换键，ok:false 信封仍会覆盖缓存；保留最后可画的日历。
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.counts.length && data !== lastDrawn) setLastDrawn(data);
  const snapshot = data?.counts.length ? data : lastDrawn;
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
