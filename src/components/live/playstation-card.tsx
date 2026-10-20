"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { useMounted } from "@/hooks/use-mounted-at";
import { useConfirmedClockStale } from "@/hooks/use-stale";
import { useStatus } from "@/hooks/use-status";
import { PLAYSTATION_STALE_MS } from "@shared/freshness";
import { GAME_COLUMN_SNAP_CLASS } from "@/lib/gaming-columns";
import { stableKeys } from "@/lib/keys";
import {
  PLAYSTATION_IMAGE_SCALE,
  playstationImage,
} from "@/lib/playstation-image";
import { countTrophies } from "@shared/trophy-counts";
import {
  LIST_DURATION,
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import { NOW_PLAYING_PATH, PLAYING_PATH } from "@/lib/paths";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  StatusResponse,
  TrophyTitleDigest,
} from "@shared/types";
import { TROPHY_TYPES } from "@shared/types";
import { cn } from "@/lib/utils";import { buildTiles, type Tile } from "@/components/live/playstation/tiles";

export { mediaApp, mergeVariants, playedFor, playTime, type MergedGame } from "@/components/live/playstation/tiles";

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

const INITIAL_TILE_COUNT = 12;

// grid-rows-3 须与 GAME_COLUMN_SNAP_CLASS 的 nth-child 步长一致。
const TILE_TRACK = cn(
  "grid grid-flow-col grid-rows-3 gap-3",
  "auto-cols-[100%]",
  "md:auto-cols-[calc((100%-0.75rem)/2)]",
  "lg:auto-cols-[calc((100%-1.5rem)/3)]",
);

export const COVER_PX = 112;
function GameTile({
  tile,
  selected,
  onSelect,
}: {
  tile: Tile;
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
            loading="lazy"
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

  // 末列不满也保留：按行数裁掉余数会把列表末尾的游戏藏起来。
  const tiles = useMemo(
    () => buildTiles(list.data, livePresence, titles ?? []),
    [list.data, livePresence, titles],
  );
  const mounted = useMounted();
  const renderedTiles = useMemo(
    () => mounted ? tiles : tiles.slice(0, INITIAL_TILE_COUNT),
    [mounted, tiles],
  );
  const reduced = useReducedMotion();
  const layout = !reduced;
  const layoutDependency = useMemo(() => [renderedTiles, layout], [renderedTiles, layout]);
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
                layout={layout}
                layoutDependency={layoutDependency}
                variants={reduced ? STATIC_VARIANTS : ROW_ITEM_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                className={cn("flex min-w-0", GAME_COLUMN_SNAP_CLASS)}
              >
                <GameTile
                  tile={tile}
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
