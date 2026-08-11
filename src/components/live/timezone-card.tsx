"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Server } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { useStatus } from "@/hooks/use-status";
import { TIMEZONE_PATH } from "@/lib/paths";
import { site } from "@/lib/site";
import type { TimezonePayload } from "@/lib/types";

/**
 * 时区内容变化不单独推送，平时只需慢速轮询。
 *
 * 推送承载的是「状态翻面」—— 换了前台应用、换了曲子、插拔充电头，晚一秒都看得
 * 出来。时区一年变两次，为它单开一路事件、再让断线时 3 秒问一遍，纯属为不会发生
 * 的事情铺路。上报器上下线是例外：整页共用的 presence 事件会让这张卡立即重取，
 * 不必等下面的轮询周期才翻转 stale。
 *
 * 60 秒这个数由「上报器掉线多久该变灰」定，不是由时区定：存活判据是 45 秒的心跳
 * 窗口，一分钟一问足够在下一轮把 stale 翻过来。
 */
const REFRESH_MS = 60_000;

const emptySubscribe = () => () => {};

/**
 * Client Component 首屏仍会在服务端预渲染。时钟若直接用 Date.now()，服务端画出的
 * 秒数和 hydrate 时的秒数可能不同；首屏两边都先画占位，挂载后再开始走钟。
 */
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function validTimezone(identifier: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: identifier }).format();
    return true;
  } catch {
    return false;
  }
}

function formatUTCOffset(seconds: number) {
  const sign = seconds < 0 ? "−" : "+";
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

function clockParts(now: number, timezone: string) {
  const date = new Date(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    hour: Number(part(time, "hour")),
    minute: Number(part(time, "minute")),
    second: Number(part(time, "second")),
    date: new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date),
    weekday: new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      weekday: "long",
    }).format(date),
  };
}

function timezoneAbbreviation(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(now));
  return parts.find((item) => item.type === "timeZoneName")?.value ?? null;
}

/** 算任意 IANA 时区在这一刻的偏移，不能用浏览器的 getTimezoneOffset。 */
function timezoneOffsetSeconds(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(part(parts, type));
  const representedAsUTC = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return representedAsUTC / 1_000 - Math.floor(now / 1_000);
}

const TWO_DIGITS = { minimumIntegerDigits: 2, useGrouping: false } as const;

export function TimezoneCard() {
  const { data, error } = useStatus<TimezonePayload>(TIMEZONE_PATH, REFRESH_MS);
  const hydrated = useHydrated();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // 对齐整秒再开始跑，避免从挂载时刻起每次都在半秒处翻数字。
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1_000);
    }, 1_000 - (Date.now() % 1_000));

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  const reportedTimezone = data?.timezone ?? null;
  const usingMac = Boolean(
    !error &&
      data &&
      !data.stale &&
      reportedTimezone &&
      validTimezone(reportedTimezone.identifier),
  );
  // Mac 停报、状态接口报错或给出无效 IANA 标识时，都回到后端配置；访客浏览器
  // 的时区绝不参与选择，否则同一页面在不同访客眼里会显示不同的“本机时间”。
  const backendTimezone = validTimezone(site.timezone) ? site.timezone : "UTC";
  const timezone = usingMac ? reportedTimezone!.identifier : backendTimezone;
  const clock = hydrated ? clockParts(now, timezone) : null;
  const abbreviation = usingMac
    ? reportedTimezone!.abbreviation
    : timezoneAbbreviation(now, timezone);
  const offsetSeconds = usingMac
    ? reportedTimezone!.secondsFromGMT
    : timezoneOffsetSeconds(now, timezone);

  return (
    <Card
      label="Current Time"
      tone={usingMac ? "live" : "idle"}
      action={usingMac ? "Mac 时区" : "后端时区"}
    >
      <div className="px-4 pb-4 pt-3">
        <div className="flex min-h-44 flex-col justify-between rounded-md border border-line bg-background/40 p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {clock ? `${clock.date} · ${clock.weekday}` : "读取后端时间…"}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground" title={timezone ?? undefined}>
                {timezone ?? "正在识别时区"}
              </div>
            </div>

            <span className="inline-flex max-w-32 shrink-0 items-center gap-1 rounded-sm border border-line px-1.5 py-px text-[10px] leading-4 text-muted-foreground">
              {usingMac ? (
                <MacBookProIcon className="size-3 shrink-0" aria-hidden />
              ) : (
                <Server className="size-3 shrink-0" aria-hidden />
              )}
              <span className="truncate">{usingMac ? "MacBook Pro" : "服务器"}</span>
            </span>
          </div>

          {clock ? (
            <NumberFlowGroup>
              <time
                className="mt-5 flex items-baseline whitespace-nowrap text-[3.25rem] font-medium leading-none tracking-[-0.055em]"
                dateTime={new Date(now).toISOString()}
                aria-label={`${clock.hour} 时 ${clock.minute} 分 ${clock.second} 秒`}
              >
                <NumberFlow value={clock.hour} locales="en-US" format={TWO_DIGITS} />
                <span className="mx-0.5 text-muted-foreground">:</span>
                <NumberFlow value={clock.minute} locales="en-US" format={TWO_DIGITS} />
                <span className="mx-0.5 text-xl text-muted-foreground">:</span>
                <NumberFlow
                  value={clock.second}
                  locales="en-US"
                  format={TWO_DIGITS}
                  className="text-xl tracking-normal text-muted-foreground"
                />
              </time>
            </NumberFlowGroup>
          ) : (
            <div className="mt-5 text-[3.25rem] font-medium leading-none tracking-[-0.055em] text-muted-foreground">
              --:--<span className="text-xl tracking-normal">:--</span>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="label-mono text-muted-foreground">系统时区</span>
            <span className="truncate text-right text-sm text-muted-foreground">
              {[formatUTCOffset(offsetSeconds), abbreviation].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
