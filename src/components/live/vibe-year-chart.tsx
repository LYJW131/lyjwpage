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
import { useStatus } from "@/hooks/use-status";
import { groupWeeks, heatmapFrame, weekdayOf } from "@/lib/github-chart-compact";
import {
  YEAR_MIX_SHOW,
  compactTokens,
  expandYearDays,
  formatTokenLabel,
  indexYearMix,
  tokenScores,
  type YearModelShare,
} from "@/lib/coding-year";
import { CODING_YEAR_PATH } from "@/lib/paths";
import type { CodingYearPayload, GithubChartDay, StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";


type HoveredCell = {
  date: string;
  tokens: number;
  models: YearModelShare[];
  anchor: CellAnchor;
};

function toWeeks(origin: string, days: number[], through: string): GithubChartDay[][] {
  const scores = tokenScores(days);
  const byDate = new Map(expandYearDays(origin, days).map((day, index) => [day.date, { tokens: day.tokens, score: scores[index] ?? 0 }]));
  return groupWeeks(
    heatmapFrame(through).map((date) => {
      const day = byDate.get(date);
      const tokens = day?.tokens ?? 0;
      return { date, weekday: weekdayOf(date), count: tokens, score: day?.score ?? 0, label: formatTokenLabel(date, tokens) };
    }),
  );
}

function mixByDate(origin: string, days: number[], models: string[], mix: number[][]) {
  const byOffset = indexYearMix(models, mix);
  const byDate = new Map<string, YearModelShare[]>();
  expandYearDays(origin, days).forEach((day, index) => {
    const parts = byOffset.get(index);
    if (parts?.length) byDate.set(day.date, parts);
  });
  return byDate;
}

function sharePercent(tokens: number, total: number) {
  if (total <= 0 || tokens <= 0) return 0;
  return Math.min(100, (tokens / total) * 100);
}

function formatPercent(tokens: number, total: number) {
  const percent = sharePercent(tokens, total);
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function MixBreakdown({
  tokens,
  models,
}: {
  tokens: number;
  models: YearModelShare[];
}) {
  const rows = models.slice(0, YEAR_MIX_SHOW);
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 min-w-0 border-t border-line pt-1.5">
      <ul className="grid min-w-0 gap-1.5">
        {rows.map((row) => (
          <li key={row.model} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={row.model}>
                {row.model}
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {compactTokens(row.tokens)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <div className="h-1 min-w-0 flex-1 bg-muted">
                <div
                  className="h-full bg-live"
                  style={{ width: `${sharePercent(row.tokens, tokens)}%` }}
                />
              </div>
              <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatPercent(row.tokens, tokens)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VibeYearChart({
  fallback,
  className,
}: {
  fallback: StatusResponse<CodingYearPayload>;
  className?: string;
}) {
  const { data } = useStatus<CodingYearPayload>(CODING_YEAR_PATH, {
    fallback,
    revalidateOnMount: false,
    revalidateOnFocus: true,
  });
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.days.length && data !== lastDrawn) setLastDrawn(data);
  const snapshot = data?.days.length ? data : lastDrawn;
  const today = useSiteDay();
  const { svgRef, shown, hotDate, previewCell, clearPreview, togglePin } =
    useHeatmapOpen<HoveredCell>();

  const weeks = useMemo(() => {
    if (!snapshot) return null;
    // updatedAt 是最后重算时间；用它截窗会在无用量日丢掉今天并与贡献图错列。
    const through = today && today > snapshot.todayAtSource ? today : snapshot.todayAtSource;
    return toWeeks(snapshot.origin, snapshot.days, through);
  }, [snapshot, today]);

  const modelsByDate = useMemo(() => {
    if (!snapshot) return new Map<string, YearModelShare[]>();
    return mixByDate(
      snapshot.origin,
      snapshot.days,
      snapshot.models ?? [],
      snapshot.mix ?? [],
    );
  }, [snapshot]);

  if (!weeks?.length) return null;

  const cellOf = (day: GithubChartDay, target: Element): HoveredCell => ({
    date: day.date,
    tokens: day.count,
    models: modelsByDate.get(day.date) ?? [],
    anchor: cellAnchor(target),
  });

  return (
    <div className={cn("github-chart vibe-year-chart", className)}>
      <HeatmapGrid
        svgRef={svgRef}
        weeks={weeks}
        hotDate={hotDate}
        label="Vibe Coding token heatmap"
        onCellPreview={(day, target) => previewCell(cellOf(day, target))}
        onCellClear={clearPreview}
        onCellToggle={(day, target) => togglePin(cellOf(day, target))}
      />
      {shown && (
        <HeatmapTooltip
          date={shown.date}
          value={compactTokens(shown.tokens)}
          unit="Token"
          anchor={shown.anchor}
        >
          <MixBreakdown tokens={shown.tokens} models={shown.models} />
        </HeatmapTooltip>
      )}
    </div>
  );
}
