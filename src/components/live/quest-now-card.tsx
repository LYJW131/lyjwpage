"use client";

import MetaMono from "@lobehub/icons/es/Meta/components/Mono";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import Image from "@/components/app-image";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { absenceCopy, questSurface } from "@/lib/absence";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";
import { STATUS_VIEWS } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";
import type { QuestNow, QuestPlaying } from "@shared/quest";

const NOW_REFRESH_MS = 60_000;

// motion 的 height:auto 包含 padding；内距须放在内层，否则收起到 0 仍会残留高度。
const EXPANDED = { height: "auto", opacity: 1, marginTop: 12, marginBottom: -3 };
const COLLAPSED = { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 };

function playingFor(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just started";
  const hours = Math.floor(minutes / 60);
  return hours ? `Playing for ${hours}h ${minutes % 60}m` : `Playing for ${minutes}m`;
}

function useNow(enabled: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

function QuestHero({ playing }: { playing: QuestPlaying }) {
  const now = useNow(playing.startedAt != null);
  const detail = [playing.details, playing.state].filter(Boolean).join(" · ");
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-3 py-3 sm:gap-x-4">
      <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted text-muted-foreground sm:size-20">
        {playing.largeImageUrl ? (
          <Image src={playing.largeImageUrl} alt={playing.name} fill sizes="80px" loading="eager" className="object-cover" unoptimized />
        ) : (
          <MetaMono size={28} aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone="live" />
          <span className="label-mono shrink-0 text-live">In Game</span>
          {now != null && playing.startedAt != null && (
            <span className="label-mono min-w-0 truncate normal-case text-muted-foreground">
              · {playingFor(Math.max(0, now - playing.startedAt))}
            </span>
          )}
        </div>
        <div className="truncate text-base font-medium leading-tight sm:text-lg" title={playing.name}>
          {playing.name}
        </div>
        {detail && (
          <div className="truncate text-sm text-muted-foreground" title={detail}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestNowCard({ nowFallback }: { nowFallback: StatusResponse<QuestNow> }) {
  useLiveEvents();
  const { data, error, awaiting } = useStatus<QuestNow>(STATUS_VIEWS.questNow.path, NOW_REFRESH_MS, { fallback: nowFallback });
  const reduced = useReducedMotion();
  const surface = questSurface(data, Boolean(error) && !data);
  const playing = surface === "playing" ? data?.playing ?? null : null;
  const quiet =
    surface === "failed"
      ? absenceCopy(awaiting ? "awaiting" : "failed")
      : surface === "unavailable"
        ? absenceCopy("unavailable")
        : null;

  return (
    <>
    {quiet ? (
      <Card id="now-gaming" label="Now Playing" action="Meta Quest" className="mt-3 scroll-mt-28">
        <p className="px-4 py-4 text-sm text-muted-foreground">{quiet}</p>
      </Card>
    ) : null}
    <AnimatePresence initial={false}>
      {playing ? (
        <motion.div
          key="quest-now"
          initial={reduced ? false : COLLAPSED}
          animate={EXPANDED}
          exit={reduced ? undefined : COLLAPSED}
          transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
          className="-mr-[3px] overflow-hidden"
        >
          <div className="pb-[3px] pr-[3px]">
            <Card id="now-gaming" label="Now Playing" action="Meta Quest" className="scroll-mt-28">
              <QuestHero playing={playing} />
            </Card>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
    </>
  );
}
