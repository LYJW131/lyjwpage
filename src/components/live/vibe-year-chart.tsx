"use client";

import { useMemo, useState } from "react";

import {
  HeatmapTooltip,
  cellAnchor,
  hoverCapable,
  useHeatmapOpen,
  type CellAnchor,
} from "@/components/live/heatmap-hover";
import { useStatus } from "@/hooks/use-status";
import {
  CELL,
  LEFT,
  STEP,
  TOP,
  chartSize,
  dayLabels,
  groupWeeks,
  monthLabels,
} from "@/lib/github-chart-compact";
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

/** 格子按天变。长间隔兜底，别跟用量卡抢请求。 */
const REFRESH_MS = 6 * 60 * 60_000;

/** 蓝留给 GitHub 贡献图。这边四档绿写在 .vibe-year-chart 的 CSS 变量里。 */
const FILLS = [
  "var(--muted)",
  "var(--year-score-1)",
  "var(--year-score-2)",
  "var(--year-score-3)",
  "var(--year-score-4)",
] as const;

type HoveredCell = {
  date: string;
  tokens: number;
  models: YearModelShare[];
  anchor: CellAnchor;
};

function toWeeks(origin: string, days: number[]): GithubChartDay[][] {
  const scores = tokenScores(days);
  const expanded = expandYearDays(origin, days);
  return groupWeeks(
    expanded.map((day, index) => ({
      date: day.date,
      weekday: day.weekday,
      count: day.tokens,
      score: scores[index] ?? 0,
      label: formatTokenLabel(day.date, day.tokens),
    })),
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
  const { data } = useStatus<VibeCodingYearPayload>(VIBECODING_YEAR_PATH, REFRESH_MS, {
    fallback,
    revalidateOnMount: false,
    revalidateOnFocus: false,
  });
  const [lastDrawn, setLastDrawn] = useState(fallback.ok ? fallback.data : null);
  if (data?.days.length && data !== lastDrawn) setLastDrawn(data);
  const snapshot = data?.days.length ? data : lastDrawn;
  const { svgRef, shown, hotDate, previewCell, clearPreview, togglePin } =
    useHeatmapOpen<HoveredCell>();

  const weeks = useMemo(() => {
    if (!snapshot) return null;
    return toWeeks(snapshot.origin, snapshot.days);
  }, [snapshot]);

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

  const { width, height } = chartSize(weeks.length);

  const cellOf = (day: GithubChartDay, target: Element): HoveredCell => ({
    date: day.date,
    tokens: day.count,
    models: modelsByDate.get(day.date) ?? [],
    anchor: cellAnchor(target),
  });

  return (
    <div className={cn("github-chart vibe-year-chart", className)}>
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        shapeRendering="geometricPrecision"
        className="block h-auto w-full"
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && hoverCapable()) clearPreview();
        }}
      >
        {monthLabels(weeks).map((label) => (
          <text
            key={`m-${label.text}-${label.x}`}
            x={label.x}
            y={label.y}
            fontSize={label.fontSize}
            display={label.hidden ? "none" : undefined}
          >
            {label.text}
          </text>
        ))}
        {dayLabels().map((label) => (
          <text
            key={`d-${label.text}`}
            x={label.x}
            y={label.y}
            fontSize={label.fontSize}
            display={label.hidden ? "none" : undefined}
          >
            {label.text}
          </text>
        ))}
        {weeks.map((week, weekIndex) =>
          week.map((day) => (
            <rect
              key={day.date}
              x={LEFT + weekIndex * STEP}
              y={TOP + day.weekday * STEP}
              width={CELL}
              height={CELL}
              data-score={day.score}
              data-hot={hotDate === day.date ? "" : undefined}
              fill={FILLS[day.score]}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" && hoverCapable()) {
                  previewCell(cellOf(day, event.currentTarget));
                }
              }}
              onClick={(event) => {
                togglePin(cellOf(day, event.currentTarget));
              }}
            />
          )),
        )}
      </svg>
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
