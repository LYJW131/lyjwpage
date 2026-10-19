"use client";

import { BedDouble, Flower } from "lucide-react";
import { useEffect, useState } from "react";

import { NowReveal } from "@/components/live/now-reveal";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import type { FocusMode, FocusNow } from "@shared/focus";
import { site } from "@shared/site";
import { STATUS_VIEWS } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";

const NOW_REFRESH_MS = 60_000;


const MODES: Record<FocusMode, { name: string; Icon: typeof Flower }> = {
  sleep: { name: "Sleep", Icon: BedDouble },
  mindfulness: { name: "Mindfulness", Icon: Flower },
};

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: site.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function FocusHero({ mode, since }: { mode: FocusMode; since: number }) {
  const now = useNow();
  const { name, Icon } = MODES[mode];
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-4 py-3 sm:gap-x-4 lg:px-5">
      <div className="flex size-16 shrink-0 items-center justify-center border border-line bg-muted sm:size-20">
        <Icon className="size-7 sm:size-8" strokeWidth={1.5} aria-hidden />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone="idle" />
          <span className="label-mono shrink-0 text-live-idle-ink">Do Not Disturb</span>
          {now != null && (
            <span className="label-mono min-w-0 truncate normal-case text-muted-foreground">
              · {elapsed(Math.max(0, now - since))}
            </span>
          )}
        </div>
        <div className="truncate text-base font-medium leading-tight sm:text-lg">{name}</div>
        <div className="truncate text-sm text-muted-foreground">Since {clock.format(since)}</div>
      </div>
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
        <Card id="now-focus" label="Focus" action="iPhone" className="scroll-mt-28">
          <FocusHero mode={mode} since={since} />
        </Card>
      ) : null}
    </NowReveal>
  );
}
