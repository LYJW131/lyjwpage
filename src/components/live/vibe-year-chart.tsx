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
import { VIBECODING_YEAR_PATH } from "@/lib/paths";
import type { GithubChartDay, StatusResponse, VibeCodingYearPayload } from "@/lib/types";
import {
  YEAR_MIX_SHOW,
  compactTokens,
  expandYearDays,
  formatTokenLabel,
  indexYearMix,
  tokenScores,
  type YearModelShare,
} from "@/lib/vibecoding-year";
import { cn } from "@/lib/utils";


type HoveredCell = {
  date: string;
  tokens: number;
  models: YearModelShare[];
  anchor: CellAnchor;
};

/**
 * 格子由窗口画（heatmapFrame，和 GitHub 那张同一个），数据按日期填进去：信封固定
 * 53 周填到本周六，今天之后的不画；跨过零点、数据里还没有的今天画成 0。
 */
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
  fallback: StatusResponse<VibeCodingYearPayload>;
  className?: string;
}) {
  const { data } = useStatus<VibeCodingYearPayload>(VIBECODING_YEAR_PATH, {
    fallback,
    // 首屏已经烧进去，挂载不再回源。切回标签页时拉一次，之后按登记表的 6 小时节奏取。
    revalidateOnMount: false,
    revalidateOnFocus: true,
  });
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.days.length && data !== lastDrawn) setLastDrawn(data);
  const snapshot = data?.days.length ? data : lastDrawn;
  // 浏览器按站点时区算的今天，跨过零点就翻；首帧没有钟是 null，按源站那份的今天画
  const today = useSiteDay();
  const { svgRef, shown, hotDate, previewCell, clearPreview, togglePin } =
    useHeatmapOpen<HoveredCell>();

  const weeks = useMemo(() => {
    if (!snapshot) return null;
    /**
     * 窗尾切到源站的今天，**不是切到 `pushedAt`**：那是上报器最后一次推送，
     * Mac 停一天，今天那格就跟着少一格，隔壁 GitHub 那张图却照常画到今天，
     * 两张图当场错开一列。见 VibeCodingYearPayload.todayAtSource。
     */
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
