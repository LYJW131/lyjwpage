"use client";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { TIMEZONE_PATH } from "@/lib/paths";
import type { TimezonePayload } from "@/lib/types";

/**
 * 时区不走 SSE，只轮询，而且不用快。
 *
 * 推送承载的是「状态翻面」—— 换了前台应用、换了曲子、插拔充电头，晚一秒都看得
 * 出来。时区一年变两次，为它单开一路事件、再让断线时 3 秒问一遍，纯属为不会发生
 * 的事情铺路。
 *
 * 60 秒这个数由「上报器掉线多久该变灰」定，不是由时区定：存活判据是 45 秒的心跳
 * 窗口，一分钟一问足够在下一轮把 stale 翻过来。
 */
const REFRESH_MS = 60_000;

function formatUTCOffset(seconds: number) {
  const sign = seconds < 0 ? "−" : "+";
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function TimezoneCard() {
  const { data, error, isLoading } = useStatus<TimezonePayload>(
    TIMEZONE_PATH,
    REFRESH_MS,
  );
  const offline = Boolean(error || data?.stale);
  const timezone = data?.timezone ?? null;

  return (
    <Card
      label="Mac Timezone"
      tone={offline ? "off" : data ? "live" : "idle"}
      action={offline ? "离线" : data ? "在线" : "等待上报"}
    >
      <div className="px-4 pb-4 pt-3">
        <div className="flex min-h-28 flex-col justify-center rounded-md border border-line bg-background/40 p-4">
          <div className="label-mono text-muted-foreground">系统时区</div>
          <div className="mt-2 truncate text-xl font-medium">
            {offline ? "—" : timezone?.identifier ?? (isLoading ? "读取中…" : "暂无数据")}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {offline
              ? "Mac 上报器不可用"
              : timezone
                ? [formatUTCOffset(timezone.secondsFromGMT), timezone.abbreviation]
                    .filter(Boolean)
                    .join(" · ")
                : "等待 Mac 上报"}
          </div>
        </div>
      </div>
    </Card>
  );
}
