"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import Image from "@/components/app-image";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { NOW_WATCHING_PATH, WATCHING_PATH } from "@/lib/paths";
import { stableKeys } from "@/lib/keys";
import {
  isNowWatching,
  pinNowWatching,
  watchProgressLabel,
  watchRunStyle,
  watchingIdentity,
} from "@/lib/watching";
import {
  LIST_DURATION,
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import type { StatusResponse, WatchingItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const NOW_REFRESH_MS = 60_000;

const LIST_REFRESH_MS = 10 * 60_000;

const UNSNAP_MS = LIST_DURATION * 1000 + 80;

const TILE_WIDTH = cn(
  "basis-[calc((100%-0.75rem)/2)]",
  "md:basis-[calc((100%-1.5rem)/3)]",
  "lg:basis-[calc((100%-2.25rem)/4)]",
);

type NowPlaying = {
  itemId: string;
  paused: boolean;
  progress: number | null;
  positionMs: number | null;
  durationMs: number | null;
};

type WatchingPayload = {
  items: WatchingItem[];
};

type NowWatchingPayload = {
  nowPlaying: NowPlaying | null;
  current: WatchingItem | null;
};

function Tile({
  item,
  live,
  paused,
  liveProgress,
  positionMs,
  durationMs,
  eager,
}: {
  item: WatchingItem;
  live: boolean;
  paused: boolean;
  liveProgress: number | null;
  positionMs: number | null;
  durationMs: number | null;
  eager?: boolean;
}) {
  const reduced = useReducedMotion();
  const progress = live && liveProgress != null ? liveProgress : item.progress;
  const percentLabel = watchProgressLabel(progress);
  const showBar = live || percentLabel != null;
  const runStyle = watchRunStyle({
    progress,
    live,
    paused,
    positionMs,
    durationMs,
    reducedMotion: Boolean(reduced),
  });
  const className = cn(
    "paper-card group relative flex h-full w-full flex-col overflow-hidden rounded-md",
    "border border-line-strong bg-surface",
    live && "border-live/40",
  );
  const image = item.backdrop ?? item.poster;

  const body = (
    <>
      <div className="relative aspect-video overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes="216px"
            loading={eager ? "eager" : "lazy"}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : null}

        {live && (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 border border-line bg-background/85 px-2 py-1 backdrop-blur-sm">
            <StatusDot tone={paused ? "idle" : "live"} />
            <span className="label-mono text-foreground">
              {paused ? "Paused" : "Now Playing"}
            </span>
          </span>
        )}

        {percentLabel && (
          <span className="label-mono absolute bottom-3 right-2 border border-line bg-background/85 px-1.5 py-1 text-foreground">
            {percentLabel}
          </span>
        )}

        {showBar && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-background/45" aria-hidden>
            <div
              className={cn(
                "h-full bg-live",
                !live && "transition-[width] duration-700",
              )}
              style={runStyle}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <div className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </div>
        <div
          className="truncate text-xs text-muted-foreground"
          title={item.subtitle}
        >
          {item.subtitle || "—"}
        </div>
      </div>
    </>
  );

  return item.link ? (
    <a href={item.link} target="_blank" rel="noreferrer noopener" className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Skeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "shrink-0 overflow-hidden rounded-md border border-line bg-surface",
            TILE_WIDTH,
          )}
        >
          <div className="aspect-video animate-pulse bg-muted" />
          <div className="space-y-2 px-3 py-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WatchingRow({
  fallback,
  nowFallback,
}: {
  fallback: StatusResponse<WatchingPayload>;
  nowFallback: StatusResponse<NowWatchingPayload>;
}) {
  useLiveEvents();
  const { data: list, error, isLoading } = useStatus<WatchingPayload>(
    WATCHING_PATH,
    LIST_REFRESH_MS,
    {
      fallback,
    },
  );
  const { data: live } = useStatus<NowWatchingPayload>(NOW_WATCHING_PATH, NOW_REFRESH_MS, {
    fallback: nowFallback,
  });

  // Emby 同一集的合并项和实际文件 ID 不同，不能仅按 ID 去重。
  const liveCurrent = live?.current ?? null;
  const data = (() => {
    if (!list) return undefined;
    return {
      items: pinNowWatching(list.items, liveCurrent),
      nowPlaying: live?.nowPlaying ?? null,
    };
  })();
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const nowPlayingId = data?.nowPlaying?.itemId;
  const firstItemId = data?.items[0]?.id;
  const firstIsLive = Boolean(
    data?.items[0] && isNowWatching(data.items[0], nowPlayingId, liveCurrent),
  );

  // 插卡时浏览器会钉住原吸附卡；动画期间关闭 scroll-snap，避免与 motion 位移竞争。
  const ids = (data?.items ?? []).map(watchingIdentity).join("\n");
  const [snappedIds, setSnappedIds] = useState(ids);
  const [reflowing, setReflowing] = useState(false);
  // 必须与插卡同次提交关闭吸附，effect 会晚一帧。
  if (snappedIds !== ids) {
    setSnappedIds(ids);
    setReflowing(true);
  }

  useEffect(() => {
    if (!reflowing) return;
    const timer = setTimeout(() => setReflowing(false), UNSNAP_MS);
    return () => clearTimeout(timer);
  }, [reflowing, ids]);

  useEffect(() => {
    if (!nowPlayingId || !firstIsLive) return;
    scrollerRef.current?.scrollTo({
      left: 0,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [firstIsLive, firstItemId, nowPlayingId, reduced]);

  const keys = stableKeys((data?.items ?? []).map(watchingIdentity));

  if (isLoading && !data) return <Skeleton />;

  if (error || !data?.items.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {error ? "Emby not connected" : "Nothing watched recently"}
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      tabIndex={0}
      role="region"
      aria-label="Recently watched"
      className={cn(
        "scroll-smooth overflow-x-auto overscroll-x-contain",
        "-mr-[3px] w-[calc(100%+3px)] pb-[3px]",
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
        reflowing ? "snap-none" : "snap-x snap-mandatory",
      )}
    >
      <div className="relative flex w-[calc(100%-3px)] gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {data.items.map((item, index) => {
            const live = isNowWatching(item, data.nowPlaying?.itemId, liveCurrent);
            return (
              <motion.div
                key={keys[index]}
                layout={!reduced}
                variants={reduced ? STATIC_VARIANTS : ROW_ITEM_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                className={cn("min-w-0 shrink-0 snap-start", TILE_WIDTH)}
              >
                <Tile
                  item={item}
                  live={live}
                  paused={live ? Boolean(data.nowPlaying?.paused) : false}
                  liveProgress={live ? (data.nowPlaying?.progress ?? null) : null}
                  positionMs={live ? (data.nowPlaying?.positionMs ?? null) : null}
                  durationMs={live ? (data.nowPlaying?.durationMs ?? null) : null}
                  eager={index < 4}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
