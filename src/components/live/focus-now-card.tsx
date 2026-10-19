"use client";

import { Moon, type LucideProps } from "lucide-react";
import { useEffect, useState } from "react";

import { NowReveal } from "@/components/live/now-reveal";
import { Card } from "@/components/ui/card";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import type { FocusMode, FocusNow } from "@shared/focus";
import { site } from "@shared/site";
import { STATUS_VIEWS } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";

const NOW_REFRESH_MS = 60_000;

const PETALS = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { cx: 12 + 5 * Math.cos(rad), cy: 12 + 5 * Math.sin(rad) };
});

function MindfulnessIcon({ className, strokeWidth = 1.5 }: LucideProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={className} aria-hidden>
      {PETALS.map(({ cx, cy }) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={4} />
      ))}
    </svg>
  );
}

const MODES: Record<FocusMode, { name: string; Icon: typeof Moon | typeof MindfulnessIcon; tint: string }> = {
  sleep: { name: "Sleep", Icon: Moon, tint: "text-signal-violet" },
  mindfulness: { name: "Mindfulness", Icon: MindfulnessIcon, tint: "text-signal-green" },
};

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: site.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// 服务端与客户端各取一次当前时刻，跨分钟边界时两边差一分钟，只压这一处文字的水合告警。
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const VARIANT: string = "a";

function FocusRow({ mode, since }: { mode: FocusMode; since: number }) {
  const now = useNow();
  const { name, Icon, tint } = MODES[mode];
  return (
    <div className="flex items-center gap-3 p-4 sm:gap-4 lg:p-5">
      <Icon className={`size-7 shrink-0 ${tint}`} strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="truncate text-lg font-semibold leading-tight lg:text-xl">Do Not Disturb</div>
        <div className="truncate text-sm text-muted-foreground">
          {name} since {clock.format(since)}
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
  const { name, Icon, tint } = MODES[mode];
  return (
    <div className="flex min-h-11 items-center gap-2 px-4 py-2 lg:px-5">
      <Icon className={`size-4 shrink-0 ${tint}`} strokeWidth={2} aria-hidden />
      <span className="shrink-0 text-sm font-medium">Do Not Disturb</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        · {name} since {clock.format(since)}
      </span>
      <span className="label-mono shrink-0 text-muted-foreground" suppressHydrationWarning>
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
          {VARIANT === "b" ? <FocusStrip mode={mode} since={since} /> : <FocusRow mode={mode} since={since} />}
        </Card>
      ) : null}
    </NowReveal>
  );
}
