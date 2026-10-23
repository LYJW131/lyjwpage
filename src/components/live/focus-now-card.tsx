"use client";

import { useEffect, useState } from "react";

import { FocusIcon } from "@/components/live/focus-icon";
import { NowReveal } from "@/components/live/now-reveal";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import type { FocusMode, FocusNow } from "@shared/focus";
import { STATUS_VIEWS } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";

const NOW_REFRESH_MS = 60_000;

const MODE_NAMES: Record<FocusMode, string> = {
  sleep: "Sleep",
  mindfulness: "Mindfulness",
};

export function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// 服务端与客户端各取一次当前时刻，跨分钟边界时两边差一分钟，只压这一处文字的水合告警。
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function FocusRow({ mode, since }: { mode: FocusMode; since: number }) {
  const now = useNow();
  return (
    <div className="flex items-center gap-3 p-4 sm:gap-4 md:hidden">
      <FocusIcon key={mode} mode={mode} className="w-7 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate text-lg font-semibold leading-tight">Do Not Disturb</div>
        <div className="truncate text-sm text-muted-foreground">
          {MODE_NAMES[mode]}
        </div>
      </div>
      <div className="shrink-0 text-2xl font-medium leading-none sm:text-3xl" suppressHydrationWarning>
        {elapsed(Math.max(0, now - since))}
      </div>
    </div>
  );
}

function FocusStrip({ mode, since }: { mode: FocusMode; since: number }) {
  const now = useNow();
  return (
    <div className="hidden min-h-11 items-center gap-2 px-4 py-2 md:flex lg:px-5">
      <FocusIcon key={mode} mode={mode} className="w-5 shrink-0" />
      <span className="shrink-0 text-sm font-medium">Do Not Disturb</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        · {MODE_NAMES[mode]}
      </span>
      <span className="shrink-0 text-sm font-medium" suppressHydrationWarning>
        {elapsed(Math.max(0, now - since))}
      </span>
    </div>
  );
}

export function FocusNowCard({ nowFallback }: { nowFallback: StatusResponse<FocusNow> }) {
  useLiveEvents();
  const { data } = useStatus<FocusNow>(STATUS_VIEWS.focusNow.path, NOW_REFRESH_MS, { fallback: nowFallback });
  const mode = data?.mode ?? null;
  const since = data?.since ?? null;

  return (
    <NowReveal revealKey="focus-now">
      {mode && since != null ? (
        <Card id="now-focus" className="scroll-mt-28">
          <FocusRow mode={mode} since={since} />
          <FocusStrip mode={mode} since={since} />
        </Card>
      ) : null}
    </NowReveal>
  );
}
