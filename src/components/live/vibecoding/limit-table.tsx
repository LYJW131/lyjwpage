"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useContext, useEffect, useState, type ReactNode } from "react";

import { PaceMarker } from "@/components/live/vibecoding/limit-meter";
import { formatReset, limitColor, limitPace, nextTickDelay, paceTickInterval } from "@/components/live/vibecoding/limits";
import { RenderClock, useMountedAt } from "@/hooks/use-mounted-at";
import { site } from "@shared/site";
import type { VibeCodingLimit } from "@shared/types";
import { cn } from "@/lib/utils";

export type LimitTableItem =
  | { key: string; title: string; limit: VibeCodingLimit }
  | { key: string; title: string; limit: null; reason: string };

function useLimitReading(limit: VibeCodingLimit) {
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
    color: limitColor(usedPercent),
    pace,
    overPace: pace != null && usedPercent / 100 > pace,
    reset: now ? formatReset(limit.resetsAt, now, baked ? site.timezone : undefined) : null,
  };
}

function Track({ href, label, children }: { href: string | null; label: string; children?: ReactNode }) {
  const bar = <span className="relative block h-1.5 w-full overflow-hidden bg-muted">{children}</span>;
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

function LimitCells({ limit, title, href, label }: { limit: VibeCodingLimit; title: string; href: string | null; label: string }) {
  const { usedPercent, color, pace, overPace, reset } = useLimitReading(limit);
  return (
    <>
      <span className="grid min-w-0" title={title}>
        <span className="truncate text-xs">{title}</span>
        <span className="text-2xs whitespace-nowrap text-muted-foreground sm:hidden">
          <ResetText reset={reset} />
        </span>
      </span>
      <Track href={href} label={label}>
        <span className="block h-full transition-[width] duration-700" style={{ width: `${usedPercent}%`, backgroundColor: color }} />
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </Track>
      <span className="text-right font-mono text-xs tabular-nums" style={{ color }}>
        <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
      </span>
      <span className="hidden text-right text-xs whitespace-nowrap text-muted-foreground sm:block">
        <ResetText reset={reset} />
      </span>
    </>
  );
}

// 每条限额的四格直接挂在同一个 grid 上，名称、轨道、读数、重置时间各自成列，轨道起止对齐。
export function LimitTable({
  items,
  href,
  agentLabel,
  className,
}: {
  items: LimitTableItem[];
  href: string | null;
  agentLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-[auto_minmax(3rem,1fr)_auto] items-center gap-x-3 sm:grid-cols-[auto_minmax(3rem,1fr)_auto_auto]", className)}>
      {items.map((item) =>
        item.limit ? (
          <LimitCells key={item.key} limit={item.limit} title={item.title} href={href} label={`${agentLabel} usage, ${item.title}`} />
        ) : (
          <span key={item.key} className="contents">
            <span className="truncate text-xs" title={item.reason}>{item.title}</span>
            <Track href={href} label={`${agentLabel} usage, ${item.title}`} />
            <span className="text-right font-mono text-xs text-muted-foreground">—</span>
            <span className="hidden text-right text-xs text-muted-foreground sm:block">Unavailable</span>
          </span>
        ),
      )}
    </div>
  );
}
