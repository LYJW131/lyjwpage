"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { RenderClock } from "@/hooks/use-mounted-at";

function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function useNow(enabled: boolean): number | null {
  const renderClock = useContext(RenderClock);
  const [now, setNow] = useState<number | null>(renderClock || null);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

export function NowGameRow({
  cover,
  platform,
  title,
  detail,
  startedAt,
}: {
  cover: ReactNode;
  platform: string;
  title: string;
  detail: string | null;
  startedAt: number | null;
}) {
  const now = useNow(startedAt != null);
  return (
    <div className="flex items-center gap-3 p-4 sm:gap-4 lg:px-5">
      <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted text-muted-foreground sm:size-16">
        {cover}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone="live" />
          <span className="label-mono shrink-0 text-live-ink">In Game</span>
          <span className="label-mono min-w-0 truncate text-muted-foreground">· {platform}</span>
        </div>
        <div className="truncate text-lg font-semibold leading-tight" title={title}>
          {title}
        </div>
        {detail && (
          <div className="truncate text-sm text-muted-foreground" title={detail}>
            {detail}
          </div>
        )}
      </div>
      {now != null && startedAt != null && (
        <div className="shrink-0 text-2xl font-medium leading-none sm:text-3xl">
          {elapsed(Math.max(0, now - startedAt))}
        </div>
      )}
    </div>
  );
}
