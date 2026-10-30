"use client";

import { useContext, useEffect, useState } from "react";

import { ForecastHover } from "@/components/live/vibecoding/forecast-hover";
import { RenderClock, useMountedAt } from "@/hooks/use-mounted-at";
import { forecastLimit, type LimitForecast } from "@/lib/limit-forecast";
import type { LimitHistoryPayload } from "@shared/limit-history";
import { site } from "@shared/site";
import type { VibeCodingLimit } from "@shared/types";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const TICK_MS = 5 * 60_000;

function formatter(options: Intl.DateTimeFormatOptions, timeZone: string | undefined) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone });
}

export function formatDuration(ms: number) {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d\u00a0${rest}h` : `${days}d`;
}

function dayTicks(from: number, to: number, timeZone: string | undefined) {
  const weekday = formatter({ weekday: "short" }, timeZone);
  const ticks: Array<{ at: number; label: string }> = [];
  let previous = weekday.format(from);
  for (let at = from + 3_600_000; at < to; at += 3_600_000) {
    const label = weekday.format(at);
    if (label !== previous) ticks.push({ at, label });
    previous = label;
  }
  return ticks;
}

export function ForecastChart({ forecast, timeZone }: { forecast: LimitForecast; timeZone: string | undefined }) {
  const span = forecast.resetAt - forecast.startAt;
  const x = (at: number) => ((at - forecast.startAt) / span) * 100;
  const y = (percent: number) => 100 - Math.min(100, Math.max(0, percent));
  const used = forecast.window.map(([at, percent]) => `${x(at)},${y(percent)}`).join(" ");
  const nowX = x(forecast.now);
  const projectionEnd = !forecast.drawProjection
    ? null
    : forecast.runOutAt != null
      ? { at: forecast.runOutAt, percent: 100 }
      : forecast.percentAtReset != null
        ? { at: forecast.resetAt, percent: forecast.percentAtReset }
        : null;
  const lockedFrom = forecast.runOutAt;
  const ticks = dayTicks(forecast.startAt, forecast.resetAt, timeZone);
  const runsOut = lockedFrom != null;

  return (
    <div className="flex min-h-40 flex-1 flex-col gap-1">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-1" aria-hidden>
        <span />
        <div className="relative h-4">
          {ticks.map((tick) => (
            <span
              key={tick.at}
              className="absolute top-0 -translate-x-1/2 text-2xs leading-none text-muted-foreground"
              style={{ left: `${x(tick.at + DAY_MS / 2)}%` }}
            >
              {x(tick.at + DAY_MS / 2) < 100 ? tick.label : null}
            </span>
          ))}
        </div>
      </div>
      <div className="grid min-h-28 flex-1 grid-cols-[2rem_minmax(0,1fr)] gap-x-1">
        <div className="relative" aria-hidden>
          {[0, 50, 100].map((percent) => (
            <span
              key={percent}
              className="absolute right-1 -translate-y-1/2 text-2xs leading-none text-muted-foreground"
              style={{ top: `${y(percent)}%` }}
            >
              {percent}%
            </span>
          ))}
        </div>
        <div className="relative border-b border-l border-line">
        {ticks.map((tick) => (
          <span key={tick.at} aria-hidden className="absolute inset-y-0 border-l border-line" style={{ left: `${x(tick.at)}%` }} />
        ))}
        {[50, 100].map((percent) => (
          <span
            key={percent}
            aria-hidden
            className="absolute inset-x-0 border-t border-dashed border-line"
            style={{ top: `${y(percent)}%` }}
          />
        ))}
        {lockedFrom != null && (
          <span
            aria-hidden
            className="limit-locked-hatched absolute inset-y-0"
            style={{ left: `${x(lockedFrom)}%`, right: 0 }}
          />
        )}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <line
            x1={x(forecast.cardAt ?? forecast.startAt)} y1="100" x2="100" y2="0"
            className="text-muted-foreground" stroke="currentColor" strokeWidth="1" strokeDasharray="1 3"
            vectorEffect="non-scaling-stroke"
          />
          {forecast.drawTarget && (
            <line
              x1={nowX} y1={y(forecast.usedPercent)} x2="100" y2="0"
              className="text-signal-green" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <polygon points={`${used} ${nowX},100 0,100`} className="fill-foreground" fillOpacity="0.08" />
          <polyline
            points={used}
            fill="none" className="text-foreground" stroke="currentColor" strokeWidth="1.5"
            strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          />
          {projectionEnd && (
            <line
              x1={nowX} y1={y(forecast.usedPercent)} x2={x(projectionEnd.at)} y2={y(projectionEnd.percent)}
              className={runsOut ? "text-signal-red" : "text-muted-foreground"}
              stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <span aria-hidden className="absolute bottom-0 left-0 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground" />
        <span
          aria-hidden
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${nowX}%`, top: `${y(forecast.usedPercent)}%` }}
        />
        {forecast.drawTarget && (
          <span aria-hidden className="absolute top-0 right-0 size-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-green" />
        )}
        {lockedFrom != null && (
          <span
            aria-hidden
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-red"
            style={{ left: `${x(lockedFrom)}%`, top: "0%" }}
          />
        )}
        <ForecastHover forecast={forecast} timeZone={timeZone} x={x} y={y} />
        </div>
      </div>
    </div>
  );
}

export function useWeeklyForecast({
  limit,
  limitAt,
  history,
  servedAt,
}: {
  limit: VibeCodingLimit | null;
  limitAt: number | null;
  history: LimitHistoryPayload | null;
  servedAt: number | null;
}) {
  const mountedAt = useMountedAt();
  const baked = useContext(RenderClock) > 0;
  const [ticked, setTicked] = useState(0);
  useEffect(() => {
    if (!mountedAt) return;
    const timer = window.setInterval(() => setTicked(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [mountedAt]);
  const now = ticked || mountedAt || servedAt || 0;
  // 水合那一帧按服务端的时区写，挂载后才换成看的人本地时区，避免两端文字不一致。
  const timeZone = baked || !mountedAt ? site.timezone : undefined;
  const points = history?.series.find((series) => series.agent === "claude" && series.key === limit?.key)?.points ?? [];
  const forecast = limit && now ? forecastLimit(limit, points, Math.min(now, limitAt ?? now)) : null;
  const newWeek = !forecast && limit?.resetsAt != null && now >= limit.resetsAt * 1000;
  return { forecast, newWeek, timeZone, now };
}

export function forecastStats(forecast: LimitForecast | null) {
  const pace = forecast?.rate != null ? forecast.rate / forecast.evenRate : null;
  return [
    { label: "Pace", value: pace != null ? `${pace.toFixed(1)}x` : "—", title: "Compared with an even pace" },
    { label: "Per day", value: forecast?.rate != null ? `${(forecast.rate * DAY_MS).toFixed(1)}%` : "—", title: undefined },
    {
      label: forecast?.runOutAt != null ? "Locked" : "At reset",
      title: undefined,
      value:
        forecast == null || forecast.rate == null
          ? "—"
          : forecast.lockedMs != null
            ? formatDuration(forecast.lockedMs)
            : `${Math.round(forecast.percentAtReset ?? 0)}%`,
    },
  ];
}

function forecastSummary(forecast: LimitForecast | null, newWeek: boolean, timeZone: string | undefined) {
  const clock = formatter({ weekday: "short", hour: "numeric", minute: "2-digit" }, timeZone);
  if (!forecast && newWeek) return { headline: "New week", detail: "Waiting for the first reading" };
  if (!forecast) return { headline: "No forecast yet", detail: "Waiting for a weekly reading" };
  const window = forecast.cardAt != null
    ? `Used ${Math.round(forecast.usedPercent)}% since the reset card ${clock.format(forecast.cardAt)}`
    : `Used ${Math.round(forecast.usedPercent)}% in ${Math.round(forecast.elapsedFraction * 100)}% of the week`;
  if (forecast.ranOut && forecast.runOutAt != null) {
    return { headline: `Ran out ${clock.format(forecast.runOutAt)}`, detail: `Locked until ${clock.format(forecast.resetAt)}` };
  }
  if (forecast.rate == null) return { headline: "New week, no forecast", detail: window };
  if (forecast.runOutAt != null) {
    return { headline: `Runs out ${clock.format(forecast.runOutAt)}`, detail: `${window}, then locked ${formatDuration(forecast.lockedMs ?? 0)}` };
  }
  return { headline: `${Math.round(forecast.percentAtReset ?? 0)}% at reset`, detail: window };
}

export function ForecastSummary({
  forecast,
  newWeek,
  timeZone,
}: {
  forecast: LimitForecast | null;
  newWeek: boolean;
  timeZone: string | undefined;
}) {
  const { headline, detail } = forecastSummary(forecast, newWeek, timeZone);
  return (
    <div className="grid gap-1.5">
      <div className={cn("text-lg leading-none font-semibold tracking-tight lg:text-xl", forecast?.runOutAt != null && "text-signal-red")}>
        {headline}
      </div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export function ForecastBlock({
  forecast,
  newWeek,
  timeZone,
}: {
  forecast: LimitForecast | null;
  newWeek: boolean;
  timeZone: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-1.5">
      {forecast ? <ForecastChart forecast={forecast} timeZone={timeZone} /> : <div className="grid min-h-40 flex-1 place-items-center border border-dashed border-line px-4 text-center text-xs text-muted-foreground">
          {newWeek ? "Forecast starts with this week's first reading" : "Forecast appears once the weekly limit is available"}
        </div>}
    </div>
  );
}
