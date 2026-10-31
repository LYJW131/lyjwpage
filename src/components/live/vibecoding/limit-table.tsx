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

function Track({ href, label, children }: { href: string | null; label: string; children?: ReactNode }) {
  const bar = <span className="relative block h-3 w-full overflow-hidden bg-muted">{children}</span>;
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

const METER = "grid min-w-0 gap-2";
const READING = "text-3xl leading-none font-medium tracking-tight tabular-nums md:text-4xl";

function LimitReadout({ limit, cap, title, href, label }: { limit: VibeCodingLimit; cap: WeeklyCap | null; title: string; href: string | null; label: string }) {
  const { usedPercent, unavailable, color, pace, overPace, reset } = useLimitReading(limit, cap);
  return (
    <div className={METER} title={unavailable > 0 ? cap?.note : undefined}>
      <div className="label-mono truncate text-muted-foreground">{title}</div>
      <div className={READING} style={{ color }}>
        <NumberFlow value={Math.round(usedPercent)} locales="en-US" />%
      </div>
      <Track href={href} label={unavailable > 0 ? `${label}. ${cap?.note}` : label}>
        <span className="block h-full transition-[width] duration-700" style={{ width: `${usedPercent}%`, backgroundColor: color }} />
        <UnavailableZone share={unavailable} />
        {pace != null && pace < 1 - unavailable && <PaceMarker pace={pace} overPace={overPace} />}
      </Track>
      <div className="truncate text-xs text-muted-foreground">
        {reset ? (
          <>
            Resets <ResetText reset={reset} />
          </>
        ) : (
          "\u00a0"
        )}
      </div>
    </div>
  );
}

export function LimitMeters({ items, href, agentLabel }: { items: LimitTableItem[]; href: string | null; agentLabel: string }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}>
      {items.map((item) =>
        item.limit ? (
          <LimitReadout key={item.key} limit={item.limit} cap={item.cap ?? null} title={item.title} href={href} label={`${agentLabel} usage, ${item.title}`} />
        ) : (
          <div key={item.key} className={METER} title={item.reason}>
            <div className="label-mono truncate text-muted-foreground">{item.title}</div>
            <div className={cn(READING, "text-muted-foreground")}>—</div>
            <Track href={href} label={`${agentLabel} usage, ${item.title}`} />
            <div className="truncate text-xs text-muted-foreground">Unavailable</div>
          </div>
        ),
      )}
    </div>
  );
}
