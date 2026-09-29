"use client";

import { useSyncExternalStore } from "react";

import { nextZonedDayStart, zonedDay } from "@/lib/heatmap-window";
import { site } from "@/lib/site";

/**
 * 跨日之后多等这么久才算翻过去：年度图首帧按源站盖的今天（todayAtSource）画，
 * 两边的钟差几秒是常事，差出来的那一下别让格子先跳一格再跳回来。
 */
const ROLLOVER_GRACE_MS = 2_000;

function siteDayNow(): string {
  return zonedDay(Date.now() - ROLLOVER_GRACE_MS, site.timezone);
}

function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const now = Date.now() - ROLLOVER_GRACE_MS;
    timer = setTimeout(() => {
      onChange();
      arm();
    }, nextZonedDayStart(now, site.timezone) - now);
  };
  arm();
  return () => clearTimeout(timer);
}

/**
 * 站点时区的「今天」（YYYY-MM-DD），跨过零点（加几秒宽限）那一刻翻过来。
 *
 * 首帧（服务端预渲染和水合）是 null：那一刻的钟两边对不上，见 useMountedAt。
 * 页面挂在后台、电脑睡着跨了日，定时器醒来时照样翻，读的是醒来那一刻的钟。
 */
export function useSiteDay(): string | null {
  return useSyncExternalStore(subscribe, siteDayNow, () => null);
}
