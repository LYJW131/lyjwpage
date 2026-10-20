"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import Image from "@/components/app-image";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";
import { NOW_WATCHING_PATH } from "@/lib/paths";
import { describeDevice, describeMedia } from "@/lib/watching-media";
import { formatClock } from "@/lib/web-player";
import type { StatusResponse, WatchingItem, WatchingMedia, WatchingPlayMethod } from "@shared/types";
import { cn } from "@/lib/utils";

const NOW_REFRESH_MS = 60_000;

// motion 的 height:auto 包含 padding；内距须放在内层，否则收起到 0 仍会残留高度。
const EXPANDED = { height: "auto", opacity: 1, marginTop: 12, marginBottom: -3 };
const COLLAPSED = { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 };

type NowPlaying = {
  itemId: string;
  paused: boolean;
  progress: number | null;
  client: string | null;
  deviceName: string | null;
  playMethod: WatchingPlayMethod | null;
  media: WatchingMedia | null;
  positionMs: number | null;
  durationMs: number | null;
};

type NowWatchingPayload = {
  nowPlaying: NowPlaying | null;
  current: WatchingItem | null;
};

function HeroWrapper({
  link,
  className,
  children,
}: {
  link: string | null;
  className: string;
  children: ReactNode;
}) {
  return link ? (
    <a href={link} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

function NowWatchingHero({
  nowPlaying,
  item,
}: {
  nowPlaying: NowPlaying;
  item: WatchingItem | null;
}) {
  const { paused } = nowPlaying;
  const device = describeDevice(nowPlaying.client, nowPlaying.deviceName);
  const chips = describeMedia(nowPlaying.media);

  const [clock, setClock] = useState<{ of: NowPlaying; startedAt: number; now: number } | null>(
    null,
  );
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setClock((previous) => {
        const at = Date.now();
        return previous?.of === nowPlaying
          ? { ...previous, now: at }
          : { of: nowPlaying, startedAt: at, now: at };
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [nowPlaying, paused]);

  const running = !paused && clock?.of === nowPlaying ? clock : null;
  const elapsed = running ? Math.max(0, running.now - running.startedAt) : 0;
  const duration = nowPlaying.durationMs;
  const position =
    nowPlaying.positionMs != null
      ? duration
        ? Math.min(duration, nowPlaying.positionMs + elapsed)
        : nowPlaying.positionMs + elapsed
      : null;
  const percent =
    position != null && duration
      ? (position / duration) * 100
      : (nowPlaying.progress ?? item?.progress ?? 0);
  const image = item?.backdrop ?? item?.poster ?? null;

  return (
    <HeroWrapper
      link={item?.link ?? null}
      className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-4 lg:px-5"
    >
      <div className="relative aspect-video w-32 shrink-0 self-start overflow-hidden rounded-md border border-line bg-muted sm:row-span-2 sm:w-52">
        {image ? (
          <Image
            src={image}
            alt={item?.title ?? ""}
            fill
            sizes="(min-width: 768px) 208px, (min-width: 640px) 176px, 128px"
            loading="eager"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1 self-center sm:self-end">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone={paused ? "idle" : "live"} />
          <span className={cn("label-mono shrink-0", paused ? "text-muted-foreground" : "text-live-ink")}>
            {paused ? "Paused" : "Watching"}
          </span>
          {device && (
            <span className="label-mono min-w-0 truncate normal-case text-muted-foreground" title={device}>
              · {device}
            </span>
          )}
        </div>
        <div className="truncate text-lg font-semibold leading-tight" title={item?.title}>
          {item?.title ?? <span className="font-normal text-muted-foreground">Loading details…</span>}
        </div>
        <div className="truncate text-sm text-muted-foreground" title={item?.subtitle}>
          {item ? item.subtitle || "—" : "\u00a0"}
        </div>
      </div>

      {position != null && duration ? (
        <div className="hidden shrink-0 flex-col items-end gap-1 self-end tabular-nums sm:flex">
          <span className={cn("text-2xl font-medium leading-none sm:text-3xl", paused && "text-muted-foreground")}>
            {formatClock(position)}
          </span>
          <span className="label-mono text-muted-foreground">/ {formatClock(duration)}</span>
        </div>
      ) : null}

      <div className="col-span-2 min-w-0 sm:col-start-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {chips.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Playback specs">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className={cn(
                    "label-mono rounded-sm border border-line px-1.5 py-0.5 normal-case text-muted-foreground sm:text-xs",
                    chip.endsWith("bps") && "max-sm:hidden",
                  )}
                >
                  {chip}
                </li>
              ))}
            </ul>
          )}
          {position != null && duration ? (
            <span className="label-mono ml-auto shrink-0 pl-1.5 normal-case tabular-nums text-muted-foreground sm:hidden">
              {formatClock(position)} / {formatClock(duration)}
            </span>
          ) : null}
        </div>
        <div className="mt-2.5 h-0.75 overflow-hidden bg-muted" aria-hidden>
          <div
            className={cn(
              "h-full",
              paused ? "bg-muted-foreground" : "bg-live transition-[width] duration-1000 ease-linear",
            )}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      </div>
    </HeroWrapper>
  );
}

export function NowWatchingCard({
  nowFallback,
}: {
  nowFallback: StatusResponse<NowWatchingPayload>;
}) {
  useLiveEvents();
  const { data: live } = useStatus<NowWatchingPayload>(NOW_WATCHING_PATH, NOW_REFRESH_MS, {
    fallback: nowFallback,
  });
  const reduced = useReducedMotion();
  const nowPlaying = live?.nowPlaying ?? null;

  return (
    <AnimatePresence initial={false}>
      {nowPlaying ? (
        <motion.div
          key="now-watching"
          initial={reduced ? false : COLLAPSED}
          animate={EXPANDED}
          exit={reduced ? undefined : COLLAPSED}
          transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
          className="-mr-[3px] overflow-hidden"
        >
          <div className="pb-[3px] pr-[3px]">
            <Card id="now-watching" className="scroll-mt-28">
              <NowWatchingHero nowPlaying={nowPlaying} item={live?.current ?? null} />
            </Card>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
