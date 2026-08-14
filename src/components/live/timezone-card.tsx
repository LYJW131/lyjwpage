"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import "@clock-ui/react/base.css";

import { Card } from "@/components/ui/card";
import { useMountedAt } from "@/hooks/use-mounted-at";
import {
  formatTimezoneRegion,
  formatUTCOffset,
  resolveTimezoneDisplay,
} from "@/lib/timezone-display";
import type { StatusResponse, TimezonePayload } from "@/lib/types";
import { cn } from "@/lib/utils";

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

type ClockFormatters = {
  time: Intl.DateTimeFormat;
  calendar: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
};

const formatterCache = new Map<string, ClockFormatters>();

function formattersFor(timezone: string): ClockFormatters {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;

  const next = {
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }),
    calendar: new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    weekday: new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      weekday: "short",
    }),
  };
  formatterCache.set(timezone, next);
  return next;
}

function timeParts(now: number, timezone: string) {
  const parts = formattersFor(timezone).time.formatToParts(new Date(now));
  return {
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second")),
  };
}

function clockParts(now: number, timezone: string) {
  const date = new Date(now);
  const { calendar, weekday } = formattersFor(timezone);
  const calendarParts = calendar.formatToParts(date);
  return {
    ...timeParts(now, timezone),
    date: `${part(calendarParts, "year")}/${part(calendarParts, "month")}/${part(calendarParts, "day")}`,
    weekday: weekday.format(date),
  };
}

const TWO_DIGITS = { minimumIntegerDigits: 2, useGrouping: false } as const;
const MAJOR_TICKS = Array.from({ length: 12 }, (_, index) => index * 5);

function handAngles(hour: number, minute: number, second: number) {
  const seconds = second % 60;
  return {
    hour: (hour % 12 + minute / 60 + seconds / 3600) * 30,
    minute: (minute + seconds / 60) * 6,
    second: second * 6,
  };
}

/**
 * 首帧角度写在渲染里，和 RSC 快照同一时刻，针一开始就在。
 * 挂载后再 rAF 改 --angle，不要卸掉重挂（LiveClock 第一帧是 0°）。
 */
function AnalogClock({
  timezone,
  hour,
  minute,
  second,
  now,
  live,
}: {
  timezone: string;
  hour: number;
  minute: number;
  second: number;
  now: number;
  live: boolean;
}) {
  const hourRef = useRef<HTMLDivElement>(null);
  const minuteRef = useRef<HTMLDivElement>(null);
  const secondRef = useRef<HTMLDivElement>(null);
  const angles = handAngles(hour, minute, second + (now % 1000) / 1000);

  useEffect(() => {
    if (!live) return;
    const hourEl = hourRef.current;
    const minuteEl = minuteRef.current;
    const secondEl = secondRef.current;
    if (!hourEl || !minuteEl || !secondEl) return;

    const apply = (stamp: number, sweep: boolean) => {
      const parts = timeParts(stamp, timezone);
      const next = handAngles(
        parts.hour,
        parts.minute,
        parts.second + (sweep ? (stamp % 1000) / 1000 : 0),
      );
      hourEl.style.setProperty("--angle", String(next.hour));
      minuteEl.style.setProperty("--angle", String(next.minute));
      secondEl.style.setProperty("--angle", String(next.second));
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      apply(Date.now(), false);
      const timer = window.setInterval(() => apply(Date.now(), false), 1_000);
      return () => window.clearInterval(timer);
    }

    let frame = requestAnimationFrame(function tick() {
      apply(Date.now(), true);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [live, timezone]);

  return (
    <ClockShell live>
      <div className="clock-ui clock-ui--bordered">
        <div className="clock-ui__face">
          {MAJOR_TICKS.map((tick) => (
            <div
              key={tick}
              className="clock-ui__tick clock-ui__tick--major"
              style={{ "--i": tick } as CSSProperties}
            />
          ))}
          <div
            ref={hourRef}
            className="clock-ui__hand clock-ui__hand--hour"
            style={{ "--angle": angles.hour } as CSSProperties}
          />
          <div
            ref={minuteRef}
            className="clock-ui__hand clock-ui__hand--minute"
            style={{ "--angle": angles.minute } as CSSProperties}
          />
          <div
            ref={secondRef}
            className="clock-ui__hand clock-ui__hand--second"
            style={{ "--angle": angles.second } as CSSProperties}
          />
          <div className="clock-ui__center" />
        </div>
      </div>
    </ClockShell>
  );
}

/**
 * 宽高写死。Safari 对 stretch + aspect-ratio / h-full 会把方盘按剩余行宽放大，
 * 圆心被挤出卡片，只剩左侧一条边。
 * size-36 (144px) / sm:size-40 (160px) 对齐这张卡扣掉 padding 后的正方形内容盒。
 */
function ClockShell({
  live = false,
  children,
  className,
}: {
  live?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "clock-ui-host relative z-0 size-36 shrink-0 sm:size-40",
        live && "is-live",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TimezoneCard({
  fallback,
  className,
}: {
  fallback: StatusResponse<TimezonePayload>;
  className?: string;
}) {
  /**
   * 首帧用缓存里的 snapshotAt，不能在页面里 Date.now()（挡预渲染），
   * 也不能用 0（1970）。服务端和 hydrate 同一份数，针和数字一开始就在。
   * 挂载后再用 useMountedAt / 计时器接到真钟。
   */
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const snapshotAt = fallback.ok ? fallback.data.snapshotAt : 0;
  const now = ticked || mountedAt || snapshotAt;

  useEffect(() => {
    // 对齐整秒再开始跑，避免从挂载时刻起每次都在半秒处翻数字。
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setTicked(Date.now());
      interval = window.setInterval(() => setTicked(Date.now()), 1_000);
    }, 1_000 - (Date.now() % 1_000));

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  // 有合法 Mac IANA 就用，没有才回退 site.timezone。不看上报器在不在线。
  const {
    identifier: timezone,
    offsetSeconds,
    usingMac,
  } = resolveTimezoneDisplay(
    fallback.ok ? fallback.data.timezone : null,
    now,
  );
  const clock = now ? clockParts(now, timezone) : null;
  const zoneLabel = [
    formatTimezoneRegion(timezone),
    offsetSeconds == null ? null : formatUTCOffset(offsetSeconds),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex h-full min-h-44 items-center justify-between gap-4 p-4 pl-5 sm:p-5">
        <div className="relative z-10 flex min-w-0 flex-col justify-center gap-1.5 sm:gap-2">
          <div className="text-xs text-muted-foreground">
            {usingMac ? "Mac 时间" : "服务器时间"}
          </div>

          {/* 大时钟数字 */}
          <div className="flex items-baseline overflow-x-visible overflow-y-clip">
            {clock ? (
              <NumberFlowGroup>
                <time
                  className="flex items-baseline whitespace-nowrap text-4xl font-semibold leading-none tracking-[-0.03em] sm:text-5xl"
                  dateTime={new Date(now).toISOString()}
                  aria-label={`${clock.hour} 时 ${clock.minute} 分 ${clock.second} 秒`}
                >
                  <NumberFlow value={clock.hour} locales="en-US" format={TWO_DIGITS} />
                  <span className="mx-0.5 text-muted-foreground">:</span>
                  <NumberFlow value={clock.minute} locales="en-US" format={TWO_DIGITS} />
                  <span className="mx-0.5 text-xl font-normal text-muted-foreground/50 sm:text-2xl">
                    :
                  </span>
                  <NumberFlow
                    value={clock.second}
                    locales="en-US"
                    format={TWO_DIGITS}
                    className="text-xl font-normal tracking-normal text-muted-foreground/50 sm:text-2xl"
                  />
                </time>
              </NumberFlowGroup>
            ) : (
              <div
                className="flex items-baseline whitespace-nowrap text-4xl font-semibold leading-none tracking-[-0.03em] text-muted-foreground sm:text-5xl"
                aria-hidden
              >
                --:--
                <span className="mx-0.5 text-xl font-normal text-muted-foreground/50 sm:text-2xl">
                  :
                </span>
                <span className="text-xl font-normal tracking-normal text-muted-foreground/50 sm:text-2xl">
                  --
                </span>
              </div>
            )}
          </div>

          {/* 日期与星期 */}
          <div className="text-sm font-medium text-muted-foreground">
            {clock ? `${clock.date} ${clock.weekday}` : "--"}
          </div>

          {/* 时区标识与 UTC 偏移 */}
          <div className="truncate font-mono text-xs text-muted-foreground" title={timezone}>
            {zoneLabel}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-center">
          {clock ? (
            <AnalogClock
              timezone={timezone}
              hour={clock.hour}
              minute={clock.minute}
              second={clock.second}
              now={now}
              live={Boolean(mountedAt || ticked)}
            />
          ) : (
            <ClockShell />
          )}
        </div>
      </div>
    </Card>
  );
}
