"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { Server } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { MacBookProIcon } from "@/components/ui/device-icons";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useReporterStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { TIMEZONE_PATH } from "@/lib/paths";
import {
  formatUTCOffset,
  resolveTimezoneDisplay,
} from "@/lib/timezone-display";
import type { StatusResponse, TimezonePayload } from "@/lib/types";

/**
 * 时区内容变化不单独推送，平时只需慢速轮询。
 *
 * 推送承载的是「状态翻面」—— 换了前台应用、换了曲子、插拔充电头，晚一秒都看得
 * 出来。时区一年变两次，为它单开一路事件、再让断线时 3 秒问一遍，纯属为不会发生
 * 的事情铺路。上报器上下线是例外：整页共用的 presence 事件会让这张卡立即重取
 * declaredOffline；超时那条浏览器拿 lastSeenAt 自己翻，不必等轮询。
 *
 * 正常上下线由整页共用的 presence 事件立即重取；固定轮询只兜实时通道不可用，
 * 以及崩溃、断网这种来不及声明离线的情况。时区内容极少变化，可以给到十分钟。
 */
const REFRESH_MS = 10 * 60_000;

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

const TWO_DIGITS = { minimumIntegerDigits: 2, useGrouping: false } as const;

export function TimezoneCard({ fallback }: { fallback: StatusResponse<TimezonePayload> }) {
  const { data, error } = useStatus<TimezonePayload>(TIMEZONE_PATH, REFRESH_MS, {
    fallback,
    // 首屏信封已经带着 Mac 时区和存活结论；挂载时不重复问，presence 事件会
    // 立即纠正上下线变化，十分钟兜底轮询只用于实时通道不可用的情况。
    revalidateOnMount: false,
  });
  const stale = useReporterStale(data);
  /**
   * 首帧（服务端那一遍和 hydrate 那一遍）now 是 0，钟面和偏移都画占位，
   * 挂载后才开始走 —— 理由见 useMountedAt。
   *
   * 0 只当哨兵，绝不能拿去算：那是 1970 年，同一个时区当时的偏移未必和今天一样
   * （Asia/Singapore 那会儿还是 +07:30），会先画错一帧再跳。
   */
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;

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

  // Mac 停报 / 报错 / 无效 IANA 时回退 site.timezone；规则见 resolveTimezoneDisplay。
  const { identifier: timezone, abbreviation, offsetSeconds, usingMac } =
    resolveTimezoneDisplay(data, error, now, stale);
  const clock = now ? clockParts(now, timezone) : null;

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

          {/* NumberFlow 的上下 mask padding 会把 52px 行盒撑到 80px；SSR 占位也用
              同一个固定槽，否则时间卡片进入视口后水合会整张长高 28px，产生 CLS。 */}
          <div className="mt-5 flex h-20 shrink-0 items-center">
            {clock ? (
              <NumberFlowGroup>
                <time
                  className="flex items-baseline whitespace-nowrap text-[3.25rem] font-medium leading-none tracking-[-0.055em]"
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
              <div className="text-[3.25rem] font-medium leading-none tracking-[-0.055em] text-muted-foreground">
                --:--<span className="text-xl tracking-normal">:--</span>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="label-mono text-muted-foreground">系统时区</span>
            <span className="truncate text-right text-sm text-muted-foreground">
              {[offsetSeconds == null ? null : formatUTCOffset(offsetSeconds), abbreviation]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
