"use client";

import { useEffect, useMemo, useState } from "react";

import { useStatus } from "@/hooks/use-status";
import {
  CELL,
  FILLS,
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
  chunkStarts,
  expandYearDays,
  formatTokenLabel,
  tokenScores,
  YEAR_DAYS,
} from "@/lib/vibecoding-year";

/** 格子按天变。长间隔兜底，别跟用量卡抢请求。 */
const REFRESH_MS = 6 * 60 * 60_000;

function overlay(
  origin: string,
  slices: Record<string, VibeCodingYearPayload>,
): number[] {
  const days = Array.from({ length: YEAR_DAYS }, () => 0);
  for (const chunk of Object.values(slices)) {
    if (chunk.origin !== origin) continue;
    const offset = Math.round(
      (Date.parse(`${chunk.from}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) /
        86_400_000,
    );
    if (!Number.isInteger(offset) || offset < 0) continue;
    for (let index = 0; index < chunk.days.length; index += 1) {
      const slot = offset + index;
      if (slot < days.length) days[slot] = chunk.days[index] ?? 0;
    }
  }
  return days;
}

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

export function VibeYearChart({
  fallback,
}: {
  fallback: StatusResponse<VibeCodingYearPayload>;
}) {
  const { data: head } = useStatus<VibeCodingYearPayload>(VIBECODING_YEAR_PATH, REFRESH_MS, {
    fallback,
    revalidateOnMount: false,
    revalidateOnFocus: false,
  });
  const [slices, setSlices] = useState<Record<string, VibeCodingYearPayload>>(() =>
    fallback.ok ? { [fallback.data.from]: fallback.data } : {},
  );

  useEffect(() => {
    if (head) {
      setSlices((current) => ({ ...current, [head.from]: head }));
    }
  }, [head]);

  useEffect(() => {
    if (!head?.origin) return;
    const missing = chunkStarts(head.origin).filter((from) => from !== head.from);
    if (missing.length === 0) return;
    const origin = head.origin;
    let cancelled = false;
    void Promise.all(
      missing.map(async (from) => {
        const response = await fetch(`${VIBECODING_YEAR_PATH}?from=${from}`, {
          cache: "no-store",
        });
        if (!response.ok) return null;
        return (await response.json()) as StatusResponse<VibeCodingYearPayload>;
      }),
    ).then((envelopes) => {
      if (cancelled) return;
      setSlices((current) => {
        const next = { ...current };
        for (const envelope of envelopes) {
          if (envelope?.ok && envelope.data.origin === origin) {
            next[envelope.data.from] = envelope.data;
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [head?.origin, head?.from, head?.pushedAt]);

  const origin = head?.origin;
  const weeks = useMemo(() => {
    if (!origin) return null;
    return toWeeks(origin, overlay(origin, slices));
  }, [origin, slices]);

  if (!weeks?.length) return null;

  const { width, height } = chartSize(weeks.length);

  return (
    <div className="github-chart border-t border-line px-4 py-4 md:px-5">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="label-mono text-muted-foreground">Past year</div>
        <span className="label-mono text-muted-foreground">Tokens / day</span>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${width} ${height}`}
        shapeRendering="geometricPrecision"
        className="block h-auto w-full"
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
              fill={FILLS[day.score]}
            >
              <title>{day.label}</title>
            </rect>
          )),
        )}
      </svg>
    </div>
  );
}
