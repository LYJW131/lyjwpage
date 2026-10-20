"use client";

import { useContext, useEffect, useState } from "react";

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

function formatDuration(ms: number) {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}\u00a0h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}\u00a0d\u00a0${rest}\u00a0h` : `${days}\u00a0d`;
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

function ForecastChart({ forecast, timeZone }: { forecast: LimitForecast; timeZone: string | undefined }) {
  const span = forecast.resetAt - forecast.startAt;
  const x = (at: number) => ((at - forecast.startAt) / span) * 100;
  const y = (percent: number) => 100 - Math.min(100, Math.max(0, percent));
  const used = forecast.window.map(([at, percent]) => `${x(at)},${y(percent)}`).join(" ");
  const nowX = x(forecast.now);
  const projectionEnd = forecast.ranOut
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
      <div className="relative min-h-28 flex-1 border-b border-line">
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
            x1="0" y1="100" x2="100" y2="0"
            className="text-muted-foreground" stroke="currentColor" strokeWidth="1" strokeDasharray="1 3"
            vectorEffect="non-scaling-stroke"
          />
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
        <span
          aria-hidden
          className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${nowX}%`, top: `${y(forecast.usedPercent)}%` }}
        />
        {lockedFrom != null && (
          <span
            aria-hidden
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal-red"
            style={{ left: `${x(lockedFrom)}%`, top: "0%" }}
          />
        )}
        <span className="absolute top-1 left-1 text-2xs leading-none text-muted-foreground">100%</span>
        <span className="absolute top-1/2 left-1 translate-y-1 text-2xs leading-none text-muted-foreground">50%</span>
      </div>
      <div className="relative h-4" aria-hidden>
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-foreground" />Used</span>
        <span className="flex items-center gap-1">
          <span className={cn("w-3 border-t-2 border-dashed", runsOut ? "border-signal-red" : "border-muted-foreground")} />
          Pace
        </span>
        <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dotted border-muted-foreground" />Even</span>
        {runsOut && <span className="flex items-center gap-1"><span className="limit-locked-hatched size-3" />Locked</span>}
      </div>
    </div>
  );
}

export function DailyUse({ forecast, timeZone }: { forecast: LimitForecast; timeZone: string | undefined }) {
  const allowed = forecast.evenRate * DAY_MS;
  const scale = Math.max(allowed * 1.5, ...forecast.days.map((day) => day.used));
  const weekday = formatter({ weekday: "short" }, timeZone);
  const columns = "grid grid-cols-7 gap-2";
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-mono text-muted-foreground">Weekly use per day</span>
        <span className="text-xs text-muted-foreground">Allowed {allowed.toFixed(1)} pp</span>
      </div>
      <div className="grid gap-1">
        <div className={cn(columns, "relative h-18 pt-4")}>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-muted-foreground"
            style={{ bottom: `calc((100% - 1rem) * ${allowed / scale})` }}
          />
          {forecast.days.map((day) => {
            const over = day.used > allowed;
            const height = (day.used / scale) * 100;
            return (
              <div
                key={day.date}
                className="relative flex min-w-0 flex-col justify-end"
                title={`${day.date} · ${Math.round(day.used)} pp${day.locked ? " · out of quota" : ""}`}
              >
                <span
                  className={cn("absolute inset-x-0 text-center text-2xs leading-none tabular-nums", over ? "text-foreground" : "text-muted-foreground")}
                  style={{ bottom: `calc(${day.locked && day.used < allowed ? 100 : height}% + 0.25rem)` }}
                >
                  {Math.round(day.used)}
                </span>
                {day.locked && day.used < allowed ? (
                  <span className="limit-locked-hatched block h-full w-full" />
                ) : (
                  <span
                    className={cn("block w-full", over ? "bg-signal-yellow" : "bg-muted-foreground/40")}
                    style={{ height: `${height}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className={columns}>
          {forecast.days.map((day) => (
            <span key={day.date} className="text-center text-2xs leading-none text-muted-foreground">
              {day.partial ? "Today" : weekday.format(new Date(`${day.date}T12:00:00Z`))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="label-mono text-muted-foreground">{label}</div>
      <div className="truncate font-mono text-sm">{value}</div>
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
  return { forecast, timeZone };
}

export function LimitForecastPanel({ forecast, timeZone }: { forecast: LimitForecast | null; timeZone: string | undefined }) {
  const clock = formatter({ weekday: "short", hour: "numeric", minute: "2-digit" }, timeZone);
  let headline = "No forecast yet";
  let detail = "Waiting for a weekly reading";
  if (forecast) {
    const window = `Used ${Math.round(forecast.usedPercent)}% in ${Math.round(forecast.elapsedFraction * 100)}% of the week`;
    if (forecast.ranOut && forecast.runOutAt != null) {
      headline = `Ran out ${clock.format(forecast.runOutAt)}`;
      detail = `Locked until ${clock.format(forecast.resetAt)}`;
    } else if (forecast.rate == null) {
      headline = "New week, no forecast";
      detail = window;
    } else if (forecast.runOutAt != null) {
      headline = `Runs out ${clock.format(forecast.runOutAt)}`;
      detail = `${window}, then locked ${formatDuration(forecast.lockedMs ?? 0)}`;
    } else {
      headline = `~${Math.round(forecast.percentAtReset ?? 0)}% at reset`;
      detail = window;
    }
  }
  const pace = forecast?.rate != null ? forecast.rate / forecast.evenRate : null;

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 lg:p-5">
      <div className="flex h-5 items-center justify-between gap-3">
        <span className="label-mono text-muted-foreground">Weekly forecast</span>
        <span className="truncate text-xs text-muted-foreground">
          {forecast ? `Resets ${clock.format(forecast.resetAt)}` : null}
        </span>
      </div>
      <div className="grid gap-1">
        <div className={cn("text-lg font-semibold tracking-tight lg:text-xl", forecast?.runOutAt != null && "text-signal-red")}>
          {headline}
        </div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {forecast ? <ForecastChart forecast={forecast} timeZone={timeZone} /> : <div className="min-h-40 flex-1 border-b border-line" />}
      <div className="grid grid-cols-3 gap-4 border-t border-line pt-4">
        <Stat label="Pace" value={pace != null ? `${pace.toFixed(1)}x even` : "—"} />
        <Stat
          label="Per day"
          value={forecast?.rate != null ? `${(forecast.rate * DAY_MS).toFixed(1)} pp` : "—"}
        />
        <Stat
          label={forecast?.runOutAt != null ? "Locked" : "At reset"}
          value={
            forecast == null || forecast.rate == null
              ? "—"
              : forecast.lockedMs != null
                ? formatDuration(forecast.lockedMs)
                : `~${Math.round(forecast.percentAtReset ?? 0)}%`
          }
        />
      </div>
    </div>
  );
}
