"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import {
  LIST_DURATION,
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import { NOW_PLAYING_PATH, PLAYING_PATH } from "@/lib/paths";
import type {
  PlaystationGame,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** 实时性由 playing / playing-now 推送负责；轮询只兜推送整体停用。 */
const REFRESH_MS = 10 * 60_000;

/** 和「最近在看」同一条规则：比动画本身多留一点再装回滚动吸附 */
const UNSNAP_MS = LIST_DURATION * 1000 + 80;

/**
 * 卡片宽度按容器等分，规则同「最近在看」；但游戏封面是 1:1 的商店图标，
 * 比 16:9 的剧照高出一截，列数各档多两列，行高才和在看那行相近。
 * 减掉的是列间 gap-3（0.75rem）总宽：(列数 - 1) × 0.75rem。
 */
const TILE_WIDTH = cn(
  "basis-[calc((100%-1.5rem)/3)]",
  "md:basis-[calc((100%-3rem)/5)]",
  "lg:basis-[calc((100%-3.75rem)/6)]",
);

function mediaApp(category: string | null | undefined): boolean {
  return category?.endsWith("_media_app") === true;
}

function playTime(milliseconds: number | null, playCount: number): string {
  if (milliseconds == null) return `游玩 ${playCount} 次`;
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) return `累计 ${Math.round(hours)} 小时`;
  if (hours >= 1) return `累计 ${hours.toFixed(1).replace(/\.0$/, "")} 小时`;
  return `累计 ${Math.max(1, Math.round(milliseconds / 60_000))} 分钟`;
}

/** 行内瓷砖的数据形状：列表项直接来，正在玩但不在列表里的现造一份 */
type Tile = {
  titleId: string;
  name: string;
  imageUrl: string | null;
  subtitle: string;
  live: boolean;
};

function GameTile({ tile, eager }: { tile: Tile; eager?: boolean }) {
  return (
    <div
      className={cn(
        // 不是链接：titleId 拼不出商店页（要另查 Content ID），点了没处去，
        // 所以也没有「最近在看」那套 hover 放大 —— 放大是可点的暗示
        "paper-card relative flex h-full w-full flex-col overflow-hidden rounded-md",
        "border border-line-strong bg-surface",
        tile.live && "border-live/40",
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {tile.imageUrl ? (
          <Image
            src={tile.imageUrl}
            alt={tile.name}
            fill
            sizes="176px"
            loading={eager ? "eager" : "lazy"}
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="label-mono flex h-full items-center justify-center text-muted-foreground">
            PS
          </div>
        )}

        {/* 压在封面右上角。封面底色不可控，垫一层模糊底片保证读得出来 */}
        {tile.live && (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 border border-line bg-background/85 px-2 py-1 backdrop-blur-sm">
            <StatusDot tone="live" />
            <span className="label-mono text-foreground">正在游玩</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <div className="truncate text-sm font-medium" title={tile.name}>
          {tile.name}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={tile.subtitle}>
          {tile.subtitle || "—"}
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={cn(
            "shrink-0 overflow-hidden rounded-md border border-line bg-surface",
            TILE_WIDTH,
          )}
        >
          <div className="aspect-square animate-pulse bg-muted" />
          <div className="space-y-2 px-3 py-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 正在玩的置顶 + 媒体应用过滤，得到最终要渲染的瓷砖序列。
 *
 * 和「最近在看」的 pinNowWatching 同一个道理：正在玩的那款不一定在最近
 * 列表里（刚开档的新游戏），不在就用 presence 里带的标题和图标现造一张。
 * presence 自己没有 category，用列表里同 titleId 的上游枚举挡媒体应用。
 */
function buildTiles(
  list: PlaystationPlayingPayload | undefined,
  presence: PlaystationPresencePayload | undefined,
): Tile[] {
  const games = (list?.items ?? []).filter((game) => !mediaApp(game.category));

  const rawPlaying = presence?.playing ?? null;
  const playingCategory = rawPlaying
    ? list?.items.find((game) => game.titleId === rawPlaying.titleId)?.category
    : null;
  const playing = rawPlaying && !mediaApp(playingCategory) ? rawPlaying : null;

  const toTile = (game: PlaystationGame, live: boolean): Tile => ({
    titleId: game.titleId,
    name: game.name,
    imageUrl: game.imageUrl,
    // 正在玩也照常给累计时长 ——「正在玩」这件事角标已经说了，副标题不用重复
    subtitle: playTime(game.playDurationMs, game.playCount),
    live,
  });

  if (!playing) return games.map((game) => toTile(game, false));

  const inList = games.find((game) => game.titleId === playing.titleId);
  const first: Tile = inList
    ? toTile(inList, true)
    : {
        titleId: playing.titleId,
        name: playing.title,
        imageUrl: playing.iconUrl,
        // 不在最近列表里（刚开档的新游戏）就没有时长可给，退到平台标识
        subtitle:
          playing.launchPlatform ?? playing.format ?? presence?.platform ?? "PlayStation",
        live: true,
      };
  return [first, ...games.filter((game) => game.titleId !== playing.titleId).map((game) => toTile(game, false))];
}

export function PlaystationRow({
  fallback,
  nowFallback,
}: {
  fallback: StatusResponse<PlaystationPlayingPayload>;
  nowFallback: StatusResponse<PlaystationPresencePayload>;
}) {
  useLiveEvents();
  const list = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, REFRESH_MS, { fallback });
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, REFRESH_MS, {
    fallback: nowFallback,
  });

  const tiles = buildTiles(list.data, presence.data);
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const liveTitleId = tiles[0]?.live ? tiles[0].titleId : null;

  /**
   * 增删瓷砖的动画期间先摘掉滚动吸附，理由和实现照搬「最近在看」：
   * 吸附容器在头部插卡片时浏览器会钉住原卡、滚动位置整格跳走，
   * 进离场动画就对不上了。
   */
  const ids = tiles.map((tile) => tile.titleId).join("\n");
  const [snappedIds, setSnappedIds] = useState(ids);
  const [reflowing, setReflowing] = useState(false);
  // 在 render 里改状态，摘吸附和插卡片才是同一次提交
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
    if (!liveTitleId) return;
    scrollerRef.current?.scrollTo({ left: 0, behavior: reduced ? "auto" : "smooth" });
  }, [liveTitleId, reduced]);

  const keys = stableKeys(tiles.map((tile) => tile.titleId));

  if (list.isLoading && presence.isLoading && !list.data && !presence.data) {
    return <Skeleton />;
  }

  if ((list.error && !list.data) || !tiles.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {list.error && !list.data ? "还没收到 PlayStation 遥测" : "最近没有游戏记录"}
      </div>
    );
  }

  return (
    // 结构和滚动行为照搬「最近在看」：吸附整卡、overscroll-x-contain 挡住
    // 触控板横滑到头触发「返回上一页」、阴影落在滚动盒内。
    <div
      ref={scrollerRef}
      tabIndex={0}
      role="region"
      aria-label="最近在玩"
      className={cn(
        "scroll-smooth overflow-x-auto overscroll-x-contain",
        "-mr-0.75 w-[calc(100%+3px)] pb-0.75",
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
        reflowing ? "snap-none" : "snap-x snap-mandatory",
      )}
    >
      <div className="relative flex w-[calc(100%-3px)] gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {tiles.map((tile, index) => (
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
              <GameTile tile={tile} eager={index < 6} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
