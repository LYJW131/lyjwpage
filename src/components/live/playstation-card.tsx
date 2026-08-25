"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { GameFlags } from "@/components/trophies/game-flags";
import { TrophyMetal } from "@/components/trophies/trophy-metal";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import { foldService } from "@/lib/playstation-entitlements";
import {
  addTrophyCounts,
  countTrophies,
  emptyTrophyCounts,
} from "@/lib/trophy-counts";
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
  TrophyTitleDigest,
} from "@/lib/types";
import { TROPHY_TYPES } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 实时性由 playing / playing-now 推送负责；轮询只兜推送整体停用。 */
const REFRESH_MS = 10 * 60_000;

/** 和「最近在看」同一条规则：比动画本身多留一点再装回滚动吸附 */
const UNSNAP_MS = LIST_DURATION * 1000 + 80;

/**
 * 两行、按列往右排。列宽按容器等分，视口里仍是整数列。
 * 减掉的是列间 gap-3（0.75rem）总宽：(列数 - 1) × 0.75rem。
 */
const TILE_TRACK = cn(
  "grid grid-flow-col grid-rows-2 gap-3",
  "auto-cols-[calc(100%-2.5rem)]",
  "md:auto-cols-[calc((100%-0.75rem)/2)]",
  "lg:auto-cols-[calc((100%-1.5rem)/3)]",
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
  service: string | null;
  preOrder: boolean;
  trophies: TrophyTitleDigest | null;
};

/**
 * 游玩列表按 titleId 对齐奖杯组。同款多 SKU 并成一条时，可能对上多份
 * 奖杯目录（例如 PS4 / PS5），杯子和进度加总，不各摆一遍。
 */
function digestFor(
  titleIds: string[],
  titles: TrophyTitleDigest[],
): TrophyTitleDigest | null {
  const matches = titles.filter((title) =>
    title.titleIds.some((id) => titleIds.includes(id)),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const earned = matches.reduce(
    (sum, title) => addTrophyCounts(sum, title.earned),
    emptyTrophyCounts(),
  );
  const defined = matches.reduce(
    (sum, title) => addTrophyCounts(sum, title.defined),
    emptyTrophyCounts(),
  );
  const total = countTrophies(defined);
  return {
    npCommunicationId: matches[0].npCommunicationId,
    name: matches[0].name,
    localizedName: matches[0].localizedName,
    titleIds: matches.flatMap((title) => title.titleIds),
    progress: total > 0 ? Math.round((countTrophies(earned) / total) * 100) : 0,
    defined,
    earned,
  };
}

function GameTile({ tile, eager }: { tile: Tile; eager?: boolean }) {
  const trophies = tile.trophies;
  const metals = trophies
    ? TROPHY_TYPES.filter((type) => trophies.earned[type] > 0)
    : [];
  return (
    <div
      className={cn(
        // 不是链接：titleId 拼不出商店页（要另查 Content ID），点了没处去。
        // 嵌在外层纸卡片里，不再套阴影，正在玩也不改边框色。
        "flex h-full w-full items-center overflow-hidden rounded-md",
        "border border-line bg-surface",
      )}
    >
      <div className="relative h-28 w-28 shrink-0 overflow-hidden border-r border-line bg-muted">
        {tile.imageUrl ? (
          <Image
            src={tile.imageUrl}
            alt={tile.name}
            width={112}
            height={112}
            sizes="112px"
            loading={eager ? "eager" : "lazy"}
            className="h-28 w-28 object-cover"
            unoptimized
          />
        ) : (
          <div className="label-mono grid h-full place-items-center text-muted-foreground">
            PS
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 px-3 py-2">
        <div className="truncate text-sm font-medium" title={tile.name}>
          {tile.name}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          {tile.live ? (
            <span className="inline-flex items-center gap-1">
              <StatusDot tone="live" />
              <span>正在游玩</span>
            </span>
          ) : (
            <span className="min-w-0 truncate" title={tile.subtitle}>
              {tile.subtitle || "—"}
            </span>
          )}
          <GameFlags service={tile.service} preOrder={tile.preOrder} plain className="shrink-0" />
        </div>
        {trophies && metals.length ? (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs tabular-nums text-muted-foreground">
            {metals.map((type) => (
              <span key={type} className="inline-flex items-center gap-0.5">
                <TrophyMetal kind={type} size="sm" />
                {trophies.earned[type]}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={cn("overflow-hidden", TILE_TRACK)}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center overflow-hidden rounded-md border border-line bg-surface"
        >
          <div className="h-28 w-28 shrink-0 animate-pulse bg-muted" />
          <div className="min-w-0 flex-1 space-y-2 px-3 py-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 两个可缺的数按给定方式合一；缺哪个就用另一个 */
function fold(
  a: number | null,
  b: number | null,
  by: (x: number, y: number) => number,
): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return by(a, b);
}

/**
 * 同名同封面的并成一条。PSN 把同一款游戏的不同 SKU 各记一条 —— 正式版和
 * 试玩、或者别的区服 —— titleId 不同，名字和封面一模一样，对访客来说就是
 * 同一款游戏，没必要在行里挨着摆两遍。时长和次数相加，首末次游玩取两头，
 * 位置留在先出现的那条（上游按最近游玩倒序给，先出现的就是更近的那次）。
 *
 * titleIds 全留着：presence 报回来的可能是其中任何一个，得都认得出来。
 */
type MergedGame = PlaystationGame & { titleIds: string[] };

function mergeVariants(games: PlaystationGame[]): MergedGame[] {
  const merged: MergedGame[] = [];
  const byLook = new Map<string, MergedGame>();
  for (const game of games) {
    // 用换行分隔，游戏名里带不出这个字符，拼不出跨字段的假重复
    const look = `${game.name}\n${game.imageUrl ?? ""}`;
    const prior = byLook.get(look);
    if (!prior) {
      const entry: MergedGame = {
        ...game,
        titleIds: [game.titleId],
        service: game.service ?? null,
        preOrder: game.preOrder === true,
      };
      byLook.set(look, entry);
      merged.push(entry);
      continue;
    }
    prior.titleIds.push(game.titleId);
    prior.playCount += game.playCount;
    prior.playDurationMs = fold(prior.playDurationMs, game.playDurationMs, (x, y) => x + y);
    prior.firstPlayedAt = fold(prior.firstPlayedAt, game.firstPlayedAt, Math.min);
    prior.lastPlayedAt = fold(prior.lastPlayedAt, game.lastPlayedAt, Math.max);
    prior.service = foldService(prior.service, game.service);
    prior.preOrder = prior.preOrder === true || game.preOrder === true;
  }
  return merged;
}

/**
 * 正在玩的置顶 + 媒体应用过滤 + 同款合并，得到最终要渲染的瓷砖序列。
 *
 * 和「最近在看」的 pinNowWatching 同一个道理：正在玩的那款不一定在最近
 * 列表里（刚开档的新游戏），不在就用 presence 里带的标题和图标现造一张。
 * presence 自己没有 category，用列表里同 titleId 的上游枚举挡媒体应用。
 */
function buildTiles(
  list: PlaystationPlayingPayload | undefined,
  presence: PlaystationPresencePayload | undefined,
  titles: TrophyTitleDigest[],
): Tile[] {
  const games = mergeVariants((list?.items ?? []).filter((game) => !mediaApp(game.category)));

  const rawPlaying = presence?.playing ?? null;
  const playingCategory = rawPlaying
    ? list?.items.find((game) => game.titleId === rawPlaying.titleId)?.category
    : null;
  const playing = rawPlaying && !mediaApp(playingCategory) ? rawPlaying : null;

  const toTile = (game: MergedGame, live: boolean): Tile => ({
    titleId: game.titleId,
    name: game.name,
    imageUrl: game.imageUrl,
    subtitle:
      game.preOrder && game.playCount === 0 && game.playDurationMs == null
        ? "尚未开档"
        : playTime(game.playDurationMs, game.playCount),
    live,
    service: game.service,
    preOrder: game.preOrder,
    trophies: digestFor(game.titleIds, titles),
  });

  if (!playing) return games.map((game) => toTile(game, false));

  // 开的可能是被并进来的那个 SKU，所以按 titleIds 认，不是只认主条目
  const inList = games.find((game) => game.titleIds.includes(playing.titleId));
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
        service: null,
        preOrder: false,
        trophies: digestFor([playing.titleId], titles),
      };
  return [first, ...games.filter((game) => game !== inList).map((game) => toTile(game, false))];
}

export function PlaystationRow({
  fallback,
  nowFallback,
  titles = [],
  inset = false,
}: {
  fallback: StatusResponse<PlaystationPlayingPayload>;
  nowFallback: StatusResponse<PlaystationPresencePayload>;
  /** 首页摘要里的各标题进度；不含逐个奖杯。 */
  titles?: TrophyTitleDigest[];
  /** 收在整块卡片里时不再为纸阴影往外探 3px。 */
  inset?: boolean;
}) {
  useLiveEvents();
  const list = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, REFRESH_MS, { fallback });
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, REFRESH_MS, {
    fallback: nowFallback,
  });

  const tiles = buildTiles(list.data, presence.data, titles);
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
      <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
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
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
        !inset && "-mr-0.75 w-[calc(100%+3px)] pb-0.75",
        reflowing ? "snap-none" : "snap-x snap-mandatory",
      )}
    >
      <div className={cn("relative", TILE_TRACK, inset ? "w-full" : "w-[calc(100%-3px)]")}>
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
              className="min-w-0 odd:snap-start"
            >
              <GameTile tile={tile} eager={index < 6} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
