"use client";

import NumberFlow, { NumberFlowGroup } from "@/components/ui/number-flow";
import { useContext, useEffect, useState, type ReactNode } from "react";

import { PaceMarker, UnavailableZone } from "@/components/live/vibecoding/limit-meter";
import { formatReset, limitColor, limitPace, nextTickDelay, paceTickInterval, unavailableShare, type WeeklyCap } from "@/components/live/vibecoding/limits";
import { RenderClock, useMountedAt } from "@/hooks/use-mounted-at";
import { site } from "@shared/site";
import type { VibeCodingLimit } from "@shared/types";
import { cn } from "@/lib/utils";

export type LimitTableItem =
  | { key: string; title: string; limit: VibeCodingLimit; cap?: WeeklyCap | null }
  | { key: string; title: string; limit: null; reason: string };

function useLimitReading(limit: VibeCodingLimit, cap: WeeklyCap | null) {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  useEffect(() => {
    if (!now || limit.resetsAt == null) return;
    const target = limit.resetsAt * 1000;
    if (now >= target) return;
    // now 是上次唤醒的快照；按它计算延迟会把已过去的时间再加一遍。
    const timer = window.setTimeout(() => setTicked(Date.now()), nextTickDelay(target - Date.now()) + 500);
    return () => window.clearTimeout(timer);
  }, [limit.resetsAt, now]);
  const windowMs = limit.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const expired = limit.resetsAt != null && limit.resetsAt * 1000 <= now;
  const usedPercent = expired ? 0 : limit.usedPercent;
  const pace = limitPace(limit, now);
  const baked = useContext(RenderClock) > 0;
  return {
    usedPercent,
    unavailable: unavailableShare(cap, limit, usedPercent, now),
    color: limitColor(usedPercent),
    pace,
    overPace: pace != null && usedPercent / 100 > pace,
    reset: now ? formatReset(limit.resetsAt, now, baked ? site.timezone : undefined) : null,
  };
}

function Track({ href, label, tall, children }: { href: string | null; label: string; tall?: boolean; children?: ReactNode }) {
  const bar = <span className={cn("relative block w-full overflow-hidden bg-muted", tall ? "h-3" : "h-1.5")}>{children}</span>;
  if (!href) return <span className="flex h-6 min-w-0 items-center">{bar}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="flex h-6 min-w-0 items-center focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live"
    >
      {bar}
    </a>
  );
}

function ResetText({ reset }: { reset: ReturnType<typeof formatReset> }) {
  return (
    <>
      {reset?.kind === "absolute" && reset.text.replace(/^Resets /, "")}
      {reset?.kind === "relative" && (
        <NumberFlowGroup>
          <span className="tabular-nums">
            in{" "}
            {reset.hours > 0 && (
              <>
                <NumberFlow value={reset.hours} locales="en-US" /> hr{" "}
              </>
            )}
            {(reset.minutes > 0 || reset.hours === 0) && (
              <>
                <NumberFlow value={reset.minutes} locales="en-US" /> min
              </>
            )}
          </span>
        </NumberFlowGroup>
      )}
    </>
  );
}

const ITEM = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:contents";
const NAME = "col-start-1 row-start-1 flex min-w-0 items-baseline gap-2 sm:col-auto sm:row-auto";
const TRACK = "col-span-2 row-start-2 sm:col-auto sm:row-auto";
const PERCENT = "col-start-2 row-start-1 text-right font-mono text-xs tabular-nums sm:col-auto sm:row-auto";

function LimitCells({ limit, cap, title, href, label, tall }: { limit: VibeCodingLimit; cap: WeeklyCap | null; title: string; href: string | null; label: string; tall?: boolean }) {
  const { usedPercent, unavailable, color, pace, overPace, reset } = useLimitReading(limit, cap);
  return (
    <div className={ITEM}>
      <span className={NAME} title={unavailable > 0 ? cap?.note : title}>
        <span className="truncate text-xs">{title}</span>
        <span className="text-2xs whitespace-nowrap text-muted-foreground sm:hidden">
          <ResetText reset={reset} />
        </span>
      </span>
      <span className={cn("grid min-w-0 sm:contents", TRACK)}>
        <Track href={href} label={unavailable > 0 ? `${label}. ${cap?.note}` : label} tall={tall}>
          <span className="block h-full transition-[width] duration-700" style={{ width: `${usedPercent}%`, backgroundColor: color }} />
          <UnavailableZone share={unavailable} />
          {pace != null && pace < 1 - unavailable && <PaceMarker pace={pace} overPace={overPace} />}
        </Track>
      </span>
      <span className={PERCENT} style={{ color }}>
        <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
      </span>
      <span className="hidden text-right text-xs whitespace-nowrap text-muted-foreground sm:block">
        <ResetText reset={reset} />
      </span>
    </div>
  );
}

// 宽屏每条限额的四格直接挂在同一个 grid 上，名称、轨道、读数、重置时间各自成列，轨道起止对齐；手机拆成两行：名称与读数，轨道独占一行。
export function LimitTable({
  items,
  href,
  agentLabel,
  tall,
  className,
}: {
  items: LimitTableItem[];
  href: string | null;
  agentLabel: string;
  tall?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-y-3 sm:grid-cols-[auto_minmax(3rem,1fr)_auto_auto] sm:items-center sm:gap-x-3 sm:gap-y-0", className)}>
      {items.map((item) =>
        item.limit ? (
          <LimitCells key={item.key} limit={item.limit} cap={item.cap ?? null} title={item.title} href={href} label={`${agentLabel} usage, ${item.title}`} tall={tall} />
        ) : (
          <div key={item.key} className={ITEM}>
            <span className={NAME} title={item.reason}>
              <span className="truncate text-xs">{item.title}</span>
              <span className="text-2xs whitespace-nowrap text-muted-foreground sm:hidden">Unavailable</span>
            </span>
            <span className={cn("grid min-w-0 sm:contents", TRACK)}>
              <Track href={href} label={`${agentLabel} usage, ${item.title}`} tall={tall} />
            </span>
            <span className={cn(PERCENT, "text-muted-foreground")}>—</span>
            <span className="hidden text-right text-xs text-muted-foreground sm:block">Unavailable</span>
          </div>
        ),
      )}
    </div>
  );
}
