"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Image from "@/components/app-image";
import { GameFlags, PlatformMarks } from "@/components/trophies/game-flags";
import {
  TrophyExpand,
  useTrophyCatalog,
  useTrophyWarmup,
  warmTileAttributes,
} from "@/components/trophies/trophy-details";
import { TrophyMetal } from "@/components/trophies/trophy-metal";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useMountedAt } from "@/hooks/use-mounted-at";
import { useConfirmedClockStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { PLAYSTATION_STALE_MS } from "@/lib/freshness";
import { stableKeys } from "@/lib/keys";
import { foldService } from "@/lib/playstation-entitlements";
import {
  PLAYSTATION_IMAGE_SCALE,
  playstationImage,
} from "@/lib/playstation-image";
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

const LIST_REFRESH_MS = 10 * 60_000;
const NOW_REFRESH_MS = 60_000;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function expandTargetHeight(el: HTMLElement): number {
  const wanted = el.querySelector("[data-trophy-groups-wanted]") != null;
  const wrap = el.querySelector<HTMLElement>("[data-trophy-groups-wrap]");
  const inner = el.querySelector<HTMLElement>("[data-trophy-groups]");
  const wrapH = wrap?.offsetHeight ?? 0;
  const innerH = inner?.offsetHeight ?? 0;
  return wanted ? el.offsetHeight - wrapH + innerH : el.offsetHeight - wrapH;
}

function useOpenHeight(openId: string | null, contentToken: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useIsomorphicLayoutEffect(() => {
    if (!openId) {
      setHeight(0);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const next = expandTargetHeight(el);
      if (next > 0) setHeight(next);
    };
    sync();
    const raf = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const wrap = el.querySelector("[data-trophy-groups-wrap]");
    const inner = el.querySelector("[data-trophy-groups]");
    if (wrap) observer.observe(wrap);
    if (inner) observer.observe(inner);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [openId, contentToken]);

  return [ref, height] as const;
}

const UNSNAP_MS = LIST_DURATION * 1000 + 80;

// TILE_ROWS、吸附选择器和裁尾规则须一致，否则最后一列会缺格。
const TILE_ROWS = 3;
const INITIAL_TILE_COUNT = 12;

const TILE_TRACK = cn(
  "grid grid-flow-col grid-rows-3 gap-3",
  "auto-cols-[100%]",
  "md:auto-cols-[calc((100%-0.75rem)/2)]",
  "lg:auto-cols-[calc((100%-1.5rem)/3)]",
);

function fillLastColumn<T>(tiles: T[]): T[] {
  if (tiles.length < TILE_ROWS) return tiles;
  const leftover = tiles.length % TILE_ROWS;
  return leftover === 0 ? tiles : tiles.slice(0, -leftover);
}

const COVER_PX = 112;

export function mediaApp(category: string | null | undefined): boolean {
  return category?.endsWith("_media_app") === true;
}

export function playTime(milliseconds: number | null, playCount: number): string {
  if (milliseconds == null) return `${playCount} ${playCount === 1 ? "play" : "plays"}`;
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) return `${Math.round(hours)} hrs played`;
  if (hours >= 1) return `${hours.toFixed(1).replace(/\.0$/, "")} hrs played`;
  return `${Math.max(1, Math.round(milliseconds / 60_000))} min played`;
}

type Tile = {
  titleId: string;
  titleIds: string[];
  name: string;
  imageUrl: string | null;
  subtitle: string;
  live: boolean;
  mediaApp: boolean;
  service: string | null;
  preOrder: boolean;
  platforms: string[];
  trophies: TrophyTitleDigest | null;
  playDurationMs: number | null;
};

function consolesFromCategory(category: string | null | undefined): string[] {
  if (!category) return [];
  if (category.startsWith("ps5")) return ["PS5"];
  if (category.startsWith("ps4")) return ["PS4"];
  return [];
}

function consolesFromPresence(...raw: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const value of raw) {
    const upper = value?.toUpperCase() ?? "";
    if (upper.includes("PS5")) found.add("PS5");
    if (upper.includes("PS4")) found.add("PS4");
  }
  return ["PS4", "PS5"].filter((name) => found.has(name));
}

function foldConsoles(a: string[], b: string[]): string[] {
  const found = new Set([...a, ...b]);
  return ["PS4", "PS5"].filter((name) => found.has(name));
}

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

function GameTile({
  tile,
  eager,
  selected,
  onSelect,
}: {
  tile: Tile;
  eager?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const trophies = tile.trophies;
  const metals = trophies
    ? TROPHY_TYPES.filter((type) => trophies.earned[type] > 0)
    : [];
  return (
    <button
      type="button"
      aria-expanded={selected}
      aria-controls={selected ? "playstation-trophies" : undefined}
      onClick={onSelect}
      className={cn(
        "flex h-full w-full cursor-pointer items-center overflow-hidden rounded-md text-left",
        "border bg-surface transition-colors hover:bg-surface-hover",
        selected ? "border-line-strong" : "border-line",
      )}
    >
      <div className="relative h-28 w-28 shrink-0 overflow-hidden border-r border-line bg-muted">
        {tile.imageUrl ? (
          <Image
            src={playstationImage(tile.imageUrl, COVER_PX * PLAYSTATION_IMAGE_SCALE)!}
            alt={tile.name}
            width={COVER_PX}
            height={COVER_PX}
            loading={eager ? "eager" : "lazy"}
            unoptimized
            className="h-28 w-28 object-cover"
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
              <span>{tile.mediaApp ? "Now Using" : "Now Playing"}</span>
            </span>
          ) : (
            <span className="min-w-0 truncate" title={tile.subtitle}>
              {tile.subtitle || "—"}
            </span>
          )}
          <GameFlags service={null} preOrder={tile.preOrder} plain className="shrink-0" />
        </div>
        <PlatformMarks platforms={tile.platforms} service={tile.service} className="mt-1" />
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
    </button>
  );
}

function Skeleton() {
  return (
    <div className={cn("overflow-hidden", TILE_TRACK)}>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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

function fold(
  a: number | null,
  b: number | null,
  by: (x: number, y: number) => number,
): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return by(a, b);
}

// 合并同款 SKU 时保留全部 titleIds，presence 可能命中其中任意一个。
export type MergedGame = PlaystationGame & { titleIds: string[]; platforms: string[] };

export function mergeVariants(games: PlaystationGame[]): MergedGame[] {
  const merged: MergedGame[] = [];
  const byLook = new Map<string, MergedGame>();
  for (const game of games) {
    const look = `${game.name}\n${game.imageUrl ?? ""}`;
    const prior = byLook.get(look);
    if (!prior) {
      const entry: MergedGame = {
        ...game,
        titleIds: [game.titleId],
        platforms: consolesFromCategory(game.category),
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
    prior.platforms = foldConsoles(prior.platforms, consolesFromCategory(game.category));
  }
  return merged;
}

function tilePriority(tile: Tile): number {
  if (tile.live) return 0;
  if ((tile.trophies?.earned.platinum ?? 0) > 0) return 1;
  if (tile.preOrder) return 2;
  return 3;
}

function prioritizeTiles(tiles: Tile[]): Tile[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const aRank = tilePriority(a.tile);
      const bRank = tilePriority(b.tile);
      if (aRank !== bRank) return aRank - bRank;
      if (aRank === 1) {
        const aMs = a.tile.playDurationMs;
        const bMs = b.tile.playDurationMs;
        if (aMs == null && bMs != null) return 1;
        if (bMs == null && aMs != null) return -1;
        if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
      }
      return a.index - b.index;
    })
    .map(({ tile }) => tile);
}

function buildTiles(
  list: PlaystationPlayingPayload | undefined,
  presence: PlaystationPresencePayload | undefined,
  titles: TrophyTitleDigest[],
): Tile[] {
  const games = mergeVariants((list?.items ?? []).filter((game) => !mediaApp(game.category)));

  const playing = presence?.playing ?? null;
  // presence 没有 category；只能从未过滤的历史列表识别媒体应用，首次出现时无法区分。
  const playingIsApp = playing
    ? mediaApp(list?.items.find((game) => game.titleId === playing.titleId)?.category)
    : false;

  const toTile = (game: MergedGame, live: boolean): Tile => ({
    titleId: game.titleId,
    titleIds: game.titleIds,
    name: game.name,
    imageUrl: game.imageUrl,
    mediaApp: false,
    subtitle:
      game.preOrder && game.playCount === 0 && game.playDurationMs == null
        ? "Not started"
        : playTime(game.playDurationMs, game.playCount),
    live,
    service: game.service,
    preOrder: game.preOrder,
    platforms: game.platforms,
    trophies: digestFor(game.titleIds, titles),
    playDurationMs: game.playDurationMs,
  });

  if (!playing) return prioritizeTiles(games.map((game) => toTile(game, false)));

  const inList = games.find((game) => game.titleIds.includes(playing.titleId));
  const first: Tile = inList
    ? toTile(inList, true)
    : {
        titleId: playing.titleId,
        titleIds: [playing.titleId],
        name: playing.title,
        imageUrl: playing.iconUrl,
        subtitle:
          playing.launchPlatform ?? playing.format ?? presence?.platform ?? "PlayStation",
        live: true,
        mediaApp: playingIsApp,
        service: null,
        preOrder: false,
        platforms: consolesFromPresence(
          playing.launchPlatform,
          playing.format,
          presence?.platform,
        ),
        trophies: digestFor([playing.titleId], titles),
        playDurationMs: null,
      };
  return prioritizeTiles([
    first,
    ...games.filter((game) => game !== inList).map((game) => toTile(game, false)),
  ]);
}

export type TrophyJump = {
  npCommunicationId: string;
  trophyKey: string;
};

export function PlaystationRow({
  fallback,
  nowFallback,
  titles = null,
  jumpRequest,
  onJumpDone,
}: {
  fallback: StatusResponse<PlaystationPlayingPayload>;
  nowFallback: StatusResponse<PlaystationPresencePayload>;
  // null 表示摘要未知；空数组才允许断言没有奖杯。
  titles?: TrophyTitleDigest[] | null;
  jumpRequest: TrophyJump | null;
  onJumpDone: () => void;
}) {
  useLiveEvents();
  const list = useStatus<PlaystationPlayingPayload>(PLAYING_PATH, LIST_REFRESH_MS, {
    fallback,
  });
  const presence = useStatus<PlaystationPresencePayload>(NOW_PLAYING_PATH, NOW_REFRESH_MS, {
    fallback: nowFallback,
  });
  const presenceStale = useConfirmedClockStale(presence.data?.observedAt, PLAYSTATION_STALE_MS, {
    validating: presence.isValidating,
    servedAt: presence.servedAt,
  });
  const livePresence = presenceStale ? undefined : presence.data;

  const tiles = fillLastColumn(buildTiles(list.data, livePresence, titles ?? []));
  const mountedAt = useMountedAt();
  const renderedTiles = mountedAt ? tiles : tiles.slice(0, INITIAL_TILE_COUNT);
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const liveTitleId = tiles[0]?.live ? tiles[0].titleId : null;
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusKey(null), []);
  const openTile = tiles.find((tile) => tile.titleId === openId) ?? null;

  /* 合并 SKU 后 digest 只保留首个目录，跳转须用摘要映射全部 titleIds。 */
  const jumpDigest = jumpRequest
    ? (titles ?? []).find(
        (title) => title.npCommunicationId === jumpRequest.npCommunicationId,
      )
    : undefined;
  const jumpTargetId = jumpDigest
    ? (tiles.find((tile) => tile.titleIds.some((id) => jumpDigest.titleIds.includes(id)))
        ?.titleId ?? null)
    : null;
  const catalog = useTrophyCatalog(openTile?.titleIds ?? null);
  const { observeSection, observeTile } = useTrophyWarmup(
    tiles.map((tile) => tile.titleIds),
  );
  const [openBodyRef, openHeight] = useOpenHeight(
    openId,
    catalog.isLoading || catalog.titles || catalog.error,
  );

  // 插入瓷砖前须关闭 scroll-snap，否则浏览器会钉住旧卡并跳走整列。
  const ids = tiles.map((tile) => tile.titleId).join("\n");
  const [snappedIds, setSnappedIds] = useState(ids);
  const [reflowing, setReflowing] = useState(false);
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

  if (openId && !openTile) {
    setOpenId(null);
    setFocusKey(null);
  }

  /* 跳转的滚动 effect 须排在归零滚动之后，同次提交时用户点选的跳转优先。 */
  let jumpLandedId: string | null = null;
  let jumpGaveUp = false;

  if (jumpRequest) {
    if (jumpTargetId) {
      if (openId !== jumpTargetId) setOpenId(jumpTargetId);
      if (focusKey !== jumpRequest.trophyKey) setFocusKey(jumpRequest.trophyKey);
      jumpLandedId = jumpTargetId;
    } else {
      jumpGaveUp = true;
    }
  }

  useEffect(() => {
    if (jumpLandedId) {
      const track = scrollerRef.current;
      const tile = track?.querySelector<HTMLElement>(
        `[data-tile="${CSS.escape(jumpLandedId)}"]`,
      );
      if (track && tile) {
        track.scrollTo({ left: tile.offsetLeft, behavior: reduced ? "auto" : "smooth" });
      }
    }
    if (jumpLandedId || jumpGaveUp) onJumpDone();
  }, [jumpLandedId, jumpGaveUp, onJumpDone, reduced]);

  const keys = stableKeys(tiles.map((tile) => tile.titleId));

  if (list.isLoading && presence.isLoading && !list.data && !presence.data) {
    return <Skeleton />;
  }

  if ((list.error && !list.data) || !tiles.length) {
    return (
      <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {list.error && !list.data ? "No PlayStation telemetry yet" : "No recent games"}
      </div>
    );
  }

  return (
    <div ref={observeSection}>
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-label="Recently played"
        className={cn(
          "scroll-smooth overflow-x-auto overscroll-x-contain",
          "scrollbar-none [&::-webkit-scrollbar]:hidden",
          reflowing ? "snap-none" : "snap-x snap-mandatory",
        )}
      >
        <div className={cn("relative w-full", TILE_TRACK)}>
          <AnimatePresence initial={false} mode="popLayout">
            {renderedTiles.map((tile, index) => (
              <motion.div
                key={keys[index]}
                ref={observeTile}
                data-tile={tile.titleId}
                {...warmTileAttributes(tile.titleIds)}
                layout={!reduced}
                variants={reduced ? STATIC_VARIANTS : ROW_ITEM_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                className="min-w-0 [&:nth-child(3n+1)]:snap-start"
              >
                <GameTile
                  tile={tile}
                  eager={index < 3}
                  selected={tile.titleId === openId}
                  onSelect={() => {
                    onJumpDone();
                    setFocusKey(null);
                    setOpenId((current) => (current === tile.titleId ? null : tile.titleId));
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {openTile ? (
          <motion.div
            key="playstation-trophies-panel"
            id="playstation-trophies"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: openHeight, opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
            className="overflow-hidden"
          >
            <div ref={openBodyRef} className="min-h-max overflow-hidden">
              <div className="mt-3 border-t border-line pt-3">
                <TrophyExpand
                  name={openTile.name}
                  titles={catalog.titles}
                  loading={catalog.isLoading}
                  error={catalog.error}
                  knownEmpty={titles != null && openTile.trophies == null}
                  rows={
                    openTile.trophies
                      ? countTrophies(openTile.trophies.defined)
                      : undefined
                  }
                  focusKey={focusKey ?? undefined}
                  onFocused={clearFocus}
                />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
