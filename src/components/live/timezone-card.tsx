"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";


import { Card } from "@/components/ui/card";
import { useMountedAt } from "@/hooks/use-mounted-at";
import {
  formatTimezoneRegion,
  formatUTCOffset,
  resolveTimezoneDisplay,
} from "@/lib/timezone-display";
import type { StatusResponse, TimezonePayload } from "@shared/types";
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
    weekday: new Intl.DateTimeFormat("en-US", {
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
const useDomEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// 缓存 HTML 里的快照时间必然陈旧；这段脚本在解析到时钟时就把它同步成本机时间，
// 让首屏直接显示当前时刻，不等 React 水合。suppressHydrationWarning 保住它写过的 DOM。
function syncClockScript(timezone: string): string {
  return `(function(){var s=document.currentScript,t=s&&s.previousElementSibling;if(!t||t.tagName!=="TIME")return;var d=new Date(),tz=${JSON.stringify(timezone)};function f(l,o){var r={},p=new Intl.DateTimeFormat(l,Object.assign({timeZone:tz},o)).formatToParts(d);for(var i=0;i<p.length;i++)r[p[i].type]=p[i].value;return r}var v=f("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}),c=t.children;if(c.length===5){c[0].textContent=v.hour;c[2].textContent=v.minute;c[4].textContent=v.second}t.dateTime=d.toISOString();t.setAttribute("aria-label",v.hour+":"+v.minute+":"+v.second);var e=t.parentElement&&t.parentElement.nextElementSibling;if(e){var cal=f("en-CA",{year:"numeric",month:"2-digit",day:"2-digit"});e.textContent=cal.year+"/"+cal.month+"/"+cal.day+" "+f("en-US",{weekday:"short"}).weekday}var h=t.parentElement&&t.parentElement.parentElement&&t.parentElement.parentElement.nextElementSibling;if(h){var a=h.querySelectorAll(".clock-ui__hand"),sc=+v.second+d.getMilliseconds()/1e3,mi=+v.minute,hr=+v.hour;if(a.length===3){a[0].style.setProperty("--angle",String((hr%12+mi/60+sc/3600)*30));a[1].style.setProperty("--angle",String((mi+sc/60)*6));a[2].style.setProperty("--angle",String((sc%60)*6))}}})();`;
}

function handAngles(hour: number, minute: number, second: number) {
  const seconds = second % 60;
  return {
    hour: (hour % 12 + minute / 60 + seconds / 3600) * 30,
    minute: (minute + seconds / 60) * 6,
    second: second * 6,
  };
}

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
  const reduced = useReducedMotion();

  useDomEffect(() => {
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

    if (reduced) {
      apply(Date.now(), false);
      const timer = window.setInterval(() => apply(Date.now(), false), 1_000);
      return () => window.clearInterval(timer);
    }

    apply(Date.now(), true);
    let frame = requestAnimationFrame(function tick() {
      apply(Date.now(), true);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [live, reduced, timezone]);

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
            suppressHydrationWarning
            className="clock-ui__hand clock-ui__hand--hour"
            style={{ "--angle": angles.hour } as CSSProperties}
          />
          <div
            ref={minuteRef}
            suppressHydrationWarning
            className="clock-ui__hand clock-ui__hand--minute"
            style={{ "--angle": angles.minute } as CSSProperties}
          />
          <div
            ref={secondRef}
            suppressHydrationWarning
            className="clock-ui__hand clock-ui__hand--second"
            style={{ "--angle": angles.second } as CSSProperties}
          />
          <div className="clock-ui__center" />
        </div>
      </div>
    </ClockShell>
  );
}

// Safari 的 stretch 配合 aspect-ratio/h-full 会错误放大方盘，必须显式宽高。
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
        "clock-ui-host relative z-0 size-32 shrink-0 md:size-36 lg:size-40",
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
  const mountedAt = useMountedAt();
  const [beat, setBeat] = useState({ now: 0, prev: 0 });
  const snapshotAt = fallback.ok ? fallback.data.snapshotAt : 0;
  const now = beat.now || mountedAt || snapshotAt;
  // 缓存页水合或休眠恢复会把快照时间一次性追平到现在，只能瞬跳；逐位滚动只留给逐秒节拍。
  const animated = beat.prev !== 0 && Math.abs(beat.now - beat.prev) < 1_500;
  const live = mountedAt !== 0 || beat.now !== 0;

  useEffect(() => {
    let interval: number | undefined;
    const tick = () => setBeat(({ now }) => ({ prev: now, now: Date.now() }));
    const timeout = window.setTimeout(() => {
      tick();
      interval = window.setInterval(tick, 1_000);
    }, 1_000 - (Date.now() % 1_000));

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

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
      <div className="flex h-full min-h-44 items-center justify-between gap-3 p-4 pl-4.5 lg:p-5 lg:gap-4">
        <div className="relative z-10 flex min-w-0 flex-col justify-center gap-1.5 sm:gap-2">
          <div className="text-xs text-muted-foreground">
            {usingMac ? "Mac Time" : "Server Time"}
          </div>

          <div className="flex items-baseline overflow-x-visible overflow-y-clip">
            {clock ? (
              <NumberFlowGroup>
                <time
                  suppressHydrationWarning
                  className="flex items-baseline whitespace-nowrap text-3xl font-semibold leading-none tracking-[-0.03em] sm:text-4xl lg:text-5xl"
                  dateTime={new Date(now).toISOString()}
                  aria-label={`${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:${String(clock.second).padStart(2, "0")}`}
                >
                  {live ? (
                    <>
                      <NumberFlow value={clock.hour} locales="en-US" format={TWO_DIGITS} animated={animated} />
                      <span className="mx-0.5 text-muted-foreground">:</span>
                      <NumberFlow value={clock.minute} locales="en-US" format={TWO_DIGITS} animated={animated} />
                      <span className="mx-0.5 text-lg font-normal text-muted-foreground/50 sm:text-xl lg:text-2xl">
                        :
                      </span>
                      <NumberFlow
                        value={clock.second}
                        locales="en-US"
                        format={TWO_DIGITS}
                        animated={animated}
                        className="text-lg font-normal tracking-normal text-muted-foreground/50 sm:text-xl lg:text-2xl"
                      />
                    </>
                  ) : (
                    <>
                      <span suppressHydrationWarning>{String(clock.hour).padStart(2, "0")}</span>
                      <span className="mx-0.5 text-muted-foreground">:</span>
                      <span suppressHydrationWarning>{String(clock.minute).padStart(2, "0")}</span>
                      <span className="mx-0.5 text-lg font-normal text-muted-foreground/50 sm:text-xl lg:text-2xl">
                        :
                      </span>
                      <span
                        suppressHydrationWarning
                        className="text-lg font-normal tracking-normal text-muted-foreground/50 sm:text-xl lg:text-2xl"
                      >
                        {String(clock.second).padStart(2, "0")}
                      </span>
                    </>
                  )}
                </time>
                {!live && (
                  <script dangerouslySetInnerHTML={{ __html: syncClockScript(timezone) }} />
                )}
              </NumberFlowGroup>
            ) : (
              <div
                className="flex items-baseline whitespace-nowrap text-3xl font-semibold leading-none tracking-[-0.03em] text-muted-foreground sm:text-4xl lg:text-5xl"
                aria-hidden
              >
                --:--
                <span className="mx-0.5 text-lg font-normal text-muted-foreground/50 sm:text-xl lg:text-2xl">
                  :
                </span>
                <span className="text-lg font-normal tracking-normal text-muted-foreground/50 sm:text-xl lg:text-2xl">
                  --
                </span>
              </div>
            )}
          </div>

          <div suppressHydrationWarning className="text-sm font-medium text-muted-foreground">
            {clock ? `${clock.date} ${clock.weekday}` : "--"}
          </div>

          <div
            className="whitespace-nowrap font-mono text-xs text-muted-foreground"
            title={timezone}
          >
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
              live={live}
            />
          ) : (
            <ClockShell />
          )}
        </div>
      </div>
    </Card>
  );
}
