"use client";

import NumberFlow, { NumberFlowGroup } from "@number-flow/react";
import { useContext, useEffect, useState, type ReactNode } from "react";

import { LIMIT_ON_PACE_COLOR, LIMIT_OVER_PACE_COLOR, formatReset, limitColor, limitPace, nextTickDelay, paceTickInterval } from "@/components/live/vibecoding/limits";
import { RenderClock, useMountedAt } from "@/hooks/use-mounted-at";
import { site } from "@shared/site";
import type { VibeCodingLimit } from "@shared/types";
import { cn } from "@/lib/utils";

export function PaceMarker({ pace, overPace }: { pace: number; overPace: boolean }) {
  if (pace < 0.1 || pace > 0.9) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-y-0 flex w-1.5 justify-center bg-surface"
      style={{ left: `calc(${pace * 100}% - 3px)` }}
    >
      <span
        className="w-0.5"
        style={{ backgroundColor: overPace ? LIMIT_OVER_PACE_COLOR : LIMIT_ON_PACE_COLOR }}
      />
    </span>
  );
}

export function UsageMeter({
  href,
  label,
  expanded,
  onToggle,
  children,
}: {
  href: string | null;
  label: string;
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const hitArea =
    "-mb-3 block pt-1.5 pb-3 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-live";
  if (onToggle) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(hitArea, "w-full cursor-pointer")}
      >
        <span className="relative block h-1.5 overflow-hidden bg-muted">{children}</span>
      </button>
    );
  }
  if (!href) {
    return <span className="relative mt-1.5 block h-1.5 overflow-hidden bg-muted">{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className={hitArea}
    >
      <span className="relative block h-1.5 overflow-hidden bg-muted">{children}</span>
    </a>
  );
}

export function LimitMeter({
  limit,
  title,
  href,
  label,
}: {
  limit: VibeCodingLimit;
  title: string;
  href: string | null;
  label: string;
}) {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt;
  useEffect(() => {
    if (!now || limit.resetsAt == null) return;
    const target = limit.resetsAt * 1000;
    if (now >= target) return;
    // now 是上次唤醒的快照；按它计算延迟会把已过去的时间再加一遍。
    const timer = window.setTimeout(
      () => setTicked(Date.now()),
      nextTickDelay(target - Date.now()) + 500,
    );
    return () => window.clearTimeout(timer);
  }, [limit.resetsAt, now]);

  const expired = limit.resetsAt != null && limit.resetsAt * 1000 <= now;
  const usedPercent = expired ? 0 : limit.usedPercent;

  const windowMs = limit.windowMinutes != null ? limit.windowMinutes * 60_000 : null;
  useEffect(() => {
    if (!now || windowMs == null || windowMs <= 0) return;
    const timer = window.setInterval(() => setTicked(Date.now()), paceTickInterval(windowMs));
    return () => window.clearInterval(timer);
  }, [now, windowMs]);

  const pace = limitPace(limit, now);
  const overPace = pace != null && usedPercent / 100 > pace;
  const color = limitColor(usedPercent);
  const baked = useContext(RenderClock) > 0;
  const reset = now ? formatReset(limit.resetsAt, now, baked ? site.timezone : undefined) : null;

  return (
    <div>
      {/* NumberFlow 合成基线会撑高行盒，固定行高并居中才能保持两侧限额条对齐。 */}
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs" title={title}>
          {title}
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {reset?.kind === "absolute" && (
            <span className="text-xs text-muted-foreground">{reset.text}</span>
          )}
          {reset?.kind === "relative" && (
            <NumberFlowGroup>
              <span className="text-xs tabular-nums text-muted-foreground">
                Resets in{" "}
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
          <span className="font-mono text-xs tabular-nums" style={{ color }}>
            <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
          </span>
        </span>
      </div>
      <UsageMeter href={href} label={label}>
        <span
          className="block h-full transition-[width] duration-700"
          style={{ width: `${usedPercent}%`, backgroundColor: color }}
        />
        {pace != null && <PaceMarker pace={pace} overPace={overPace} />}
      </UsageMeter>
    </div>
  );
}

export function LimitUnavailable({
  title,
  reason,
  href,
  label,
}: {
  title: string;
  reason: string;
  href: string | null;
  label: string;
}) {
  return (
    <div title={reason}>
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="truncate text-xs">{title}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Unavailable</span>
          <span className="label-mono text-muted-foreground">—</span>
        </span>
      </div>
      <UsageMeter href={href} label={label} />
    </div>
  );
}
