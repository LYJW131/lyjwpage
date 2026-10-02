"use client";

import { EyeOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import useSWR, { useSWRConfig } from "swr";

import Image from "@/components/app-image";
import { TrophyMetal } from "@/components/trophies/trophy-metal";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";
import { trophiesTilePath } from "@/lib/paths";
import { isRestReady, subscribeRestReady } from "@/lib/rest-ready";
import { site } from "@/lib/site";
import {
  TROPHY_VISIBLE_ROWS as VISIBLE_ROWS,
  fetchCatalog,
  prefetchCatalogs,
  trophyIconSrc,
  warmTrophyIcons,
} from "@/lib/trophy-catalog";
import type { StatusResponse, TrophiesPayload, Trophy, TrophyTitle } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATALOG_REFRESH_MS = 10 * 60_000;
const WARM_AHEAD_MARGIN = "100% 0px";
const WARM_TILE_ATTR = "data-warm-title-ids";

export function warmTileAttributes(titleIds: readonly string[]) {
  return { [WARM_TILE_ATTR]: titleIds.join(",") };
}

const MIN_ROW_HEIGHT_PX = 56;
const SETTLE_DELAY_MS = 110;
const SUSPEND_AFTER_CHANGE_MS = 500;

const FLASH_MS = 1000;

export function trophyRowKey(
  npCommunicationId: string,
  groupId: string,
  id: number,
): string {
  return `${npCommunicationId}-${groupId}-${id}`;
}

function groupTrack(count: number) {
  return cn(
    "grid grid-flow-col grid-rows-1 gap-3",
    count <= 2
      ? ["auto-cols-[100%]", "md:auto-cols-[calc((100%-0.75rem)/2)]"]
      : [
          "auto-cols-[100%]",
          "md:auto-cols-[calc((100%-0.75rem)/2)]",
          "lg:auto-cols-[calc((100%-1.5rem)/3)]",
        ],
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function formatStamp(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    timeZone: site.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function trophyDetail(trophy: Trophy): string | null {
  if (trophy.hidden && !trophy.earned) return "Revealed once earned";
  return trophy.detail;
}

function rarityLabel(rate: number): string {
  if (rate < 5) return "Ultra Rare";
  if (rate < 15) return "Very Rare";
  if (rate < 50) return "Rare";
  return "Common";
}

function formatEarnedRate(rate: number): string {
  const clamped = Math.min(100, Math.max(0, rate));
  const tenths = Math.round(clamped * 10) / 10;
  if (clamped > 0 && tenths === 0) return "<0.1%";
  return `${Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1)}%`;
}

function notReady(): boolean {
  return false;
}

// 卡片进入前方一屏且首屏已加载完，就把全部瓷砖的目录并成一次请求预取；
// 首屏图标按瓷砖是否在视口内预热，不依赖悬停（触屏没有悬停信号）。
export function useTrophyWarmup(tiles: readonly (readonly string[])[]) {
  const { cache, mutate } = useSWRConfig();
  const restReady = useSyncExternalStore(subscribeRestReady, isRestReady, notReady);
  const [near, setNear] = useState(false);
  const latestTiles = useRef(tiles);
  const visible = useRef(new Map<Element, readonly string[]>());
  const tileObserver = useRef<IntersectionObserver | null>(null);
  const signature = tiles.map((titleIds) => trophiesTilePath(titleIds)).join("\n");

  useEffect(() => {
    latestTiles.current = tiles;
  });

  useEffect(() => {
    if (!near || !restReady) return;
    prefetchCatalogs(latestTiles.current, cache, mutate)?.then(() => {
      for (const titleIds of visible.current.values()) warmTrophyIcons(titleIds, cache);
    });
  }, [near, restReady, signature, cache, mutate]);

  const observeSection = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: WARM_AHEAD_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const observeTile = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      tileObserver.current ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) {
              visible.current.delete(entry.target);
              continue;
            }
            const ids = entry.target.getAttribute(WARM_TILE_ATTR)?.split(",") ?? [];
            visible.current.set(entry.target, ids);
            warmTrophyIcons(ids, cache);
          }
        },
        { threshold: 0.5 },
      );
      const observer = tileObserver.current;
      observer.observe(el);
      return () => {
        observer.unobserve(el);
        visible.current.delete(el);
      };
    },
    [cache],
  );

  return { observeSection, observeTile };
}

// 禁用 keepPreviousData，避免切游戏后暂时展示上一款的奖杯。
export function useTrophyCatalog(titleIds: string[] | null) {
  const key = titleIds ? trophiesTilePath(titleIds) : null;
  const { data, error, isLoading } = useSWR<StatusResponse<TrophiesPayload>>(
    key,
    fetchCatalog,
    {
      refreshInterval: key ? CATALOG_REFRESH_MS : 0,
      shouldRetryOnError: false,
      dedupingInterval: 60_000,
    },
  );
  return {
    titles: data?.ok ? data.data.titles : undefined,
    error: data && !data.ok ? data.error : error ? String(error.message ?? error) : undefined,
    isLoading,
  };
}

function useRowSnap(topKey: string | undefined) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(topKey);
  const suspendUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    suspendUntil.current = Date.now() + SUSPEND_AFTER_CHANGE_MS;

    const el = node.current;
    if (!el || el.scrollTop === 0) return;
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.style.scrollBehavior = saved;
  }, [topKey]);

  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (!el) return;

    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (Date.now() < suspendUntil.current) return;
        const rowHeight = el.clientHeight / VISIBLE_ROWS;
        const target = Math.round(el.scrollTop / rowHeight) * rowHeight;
        if (Math.abs(target - el.scrollTop) < 0.5) return;
        el.scrollTo({ top: target, behavior: "smooth" });
      }, SETTLE_DELAY_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
      node.current = null;
    };
  }, []);
}

function TrophyRow({ trophy, firstScreen }: { trophy: Trophy; firstScreen: boolean }) {
  const hidden = trophy.hidden && !trophy.earned;
  const locked = !trophy.earned;
  const subtitle =
    trophyDetail(trophy) ??
    (trophy.earned && trophy.earnedAt ? formatStamp(trophy.earnedAt) : "Unearned");
  const rate = trophy.earnedRate;
  const fill = rate == null ? null : Math.min(100, Math.max(0, rate));
  return (
    <div className="relative flex h-full items-center overflow-hidden rounded-md transition-colors hover:bg-surface-hover">
      {fill != null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 bg-foreground/8"
          style={{ width: `${fill}%` }}
        />
      ) : null}
      <div className="relative flex h-full min-w-0 flex-1 items-center gap-2.5 px-2">
        <div
          className={cn(
            "relative size-11 shrink-0 overflow-hidden rounded-sm border border-line bg-muted",
            locked && !hidden && "grayscale",
            hidden && "border-dashed",
          )}
        >
          {trophy.iconUrl && !hidden ? (
            <Image
              src={trophyIconSrc(trophy.iconUrl)}
              alt=""
              fill
              unoptimized
              fetchPriority={firstScreen ? "high" : "low"}
              className={cn("object-cover", locked && "opacity-55")}
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">
              {hidden ? (
                <EyeOff className="size-4" strokeWidth={1.75} />
              ) : (
                <TrophyMetal kind={trophy.type} size="sm" />
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <TrophyMetal
              kind={trophy.type}
              size="sm"
              className={cn(locked && "grayscale opacity-55")}
            />
            <span
              className={cn("min-w-0 truncate text-sm", locked && "text-muted-foreground")}
              title={hidden ? "Hidden trophy" : trophy.name}
            >
              {hidden ? "Hidden trophy" : trophy.name}
            </span>
            {locked ? <span className="sr-only">Unearned</span> : null}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={subtitle}>
            {subtitle}
          </div>
        </div>
        {rate != null ? (
          <span className="shrink-0 text-muted-foreground">
            <span className="text-xs">{rarityLabel(rate)}</span>
            <span className="text-xs"> · </span>
            <span className="label-mono">
              <span className="sr-only">Earned by </span>
              {formatEarnedRate(rate)}
              <span className="sr-only"> of players</span>
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupSlot({
  groups,
  resetKey,
}: {
  groups: { key: string; group: TrophyTitle["groups"][number] }[];
  resetKey: string | undefined;
}) {
  const reduced = useReducedMotion();
  const open = groups.length > 0;
  const [shown, setShown] = useState(groups);
  if (open && shown !== groups) setShown(groups);

  return (
    <motion.div
      data-trophy-groups-wrap=""
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
      className="overflow-hidden"
    >
      {shown.length ? (
        // aria-hidden 不移除 Tab 焦点，收起期间须用 inert 隔离仍挂载的节点。
        <div data-trophy-groups="" className="pb-2" inert={!open}>
          <GroupStrip groups={shown} resetKey={resetKey} />
        </div>
      ) : null}
    </motion.div>
  );
}

function GroupStrip({
  groups,
  resetKey,
}: {
  groups: { key: string; group: TrophyTitle["groups"][number] }[];
  resetKey: string | undefined;
}) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(resetKey);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === resetKey) return;
    previous.current = resetKey;
    const el = node.current;
    if (!el || el.scrollLeft === 0) return;
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollLeft = 0;
    el.style.scrollBehavior = saved;
  }, [resetKey]);

  return (
    <div
      ref={node}
      tabIndex={0}
      role="region"
      aria-label="Trophy groups"
      className={cn(
        "scroll-smooth overflow-x-auto overscroll-x-contain",
        "snap-x snap-mandatory",
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
      )}
    >
      <div className={groupTrack(groups.length)}>
        {groups.map(({ key, group }) => (
          <div key={key} className="min-w-0 snap-start">
            <div className="flex items-stretch overflow-hidden border border-line bg-surface">
              {group.iconUrl ? (
                <div className="relative w-10 shrink-0 self-stretch overflow-hidden border-r border-line bg-muted">
                  <Image
                    src={trophyIconSrc(group.iconUrl)}
                    alt=""
                    fill
                    unoptimized
                    className="object-cover"
                  />
                </div>
              ) : null}
              <div className="min-w-0 flex-1 px-2 py-1.5">
                <div className="truncate text-xs font-medium">{group.name}</div>
                <div className="label-mono text-muted-foreground">{group.progress}%</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrophyViewport({
  listRef,
  children,
}: {
  listRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative" style={{ height: MIN_ROW_HEIGHT_PX * VISIBLE_ROWS }}>
      <div
        ref={listRef}
        tabIndex={0}
        role="region"
        aria-label="Trophies"
        className={cn(
          "absolute inset-0 grid overflow-y-auto",
          "scroll-smooth overscroll-y-contain [overflow-anchor:none]",
          "scrollbar-none [&::-webkit-scrollbar]:hidden",
        )}
        style={{ gridAutoRows: `calc(100% / ${VISIBLE_ROWS})` }}
      >
        {children}
      </div>
    </div>
  );
}

function TrophySkeleton({ rows }: { rows: number }) {
  const count = Math.max(1, Math.min(rows, VISIBLE_ROWS));
  return (
    <TrophyViewport>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-full items-center gap-2.5 rounded-md px-2">
          <div className="size-11 shrink-0 animate-pulse rounded-sm bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </TrophyViewport>
  );
}

export function TrophyExpand({
  name,
  titles,
  loading,
  error,
  rows = VISIBLE_ROWS,
  knownEmpty = false,
  focusKey,
  onFocused,
}: {
  name: string;
  titles: TrophyTitle[] | undefined;
  loading: boolean;
  error?: string;
  rows?: number;
  knownEmpty?: boolean;
  focusKey?: string;
  onFocused?: () => void;
}) {
  const reduced = useReducedMotion();
  const trophies = titles?.flatMap((title) =>
    title.trophies.map((trophy) => ({
      key: trophyRowKey(title.npCommunicationId, trophy.groupId, trophy.id),
      trophy,
    })),
  );
  const groups =
    titles?.flatMap((title) =>
      title.groups.length > 1
        ? title.groups.map((group) => ({
            key: `${title.npCommunicationId}-${group.id}`,
            group,
          }))
        : [],
    ) ?? [];
  const snapRef = useRowSnap(trophies?.[0]?.key);
  const viewport = useRef<HTMLDivElement | null>(null);
  const listRef = useCallback(
    (el: HTMLDivElement | null) => {
      viewport.current = el;
      const detach = snapRef(el);
      return () => {
        viewport.current = null;
        detach?.();
      };
    },
    [snapRef],
  );

  const [flashKey, setFlashKey] = useState<string | null>(null);
  const focusIndex = focusKey ? (trophies?.findIndex((row) => row.key === focusKey) ?? -1) : -1;

  useEffect(() => {
    const el = viewport.current;
    if (focusIndex < 0 || !el) return;
    /* scrollIntoView 会带动全部祖先，与外层页面定位冲突；这里只滚自身容器。 */
    const rowHeight = el.clientHeight / VISIBLE_ROWS;
    const centered = focusIndex * rowHeight - (el.clientHeight - rowHeight) / 2;
    const top = Math.min(Math.max(centered, 0), el.scrollHeight - el.clientHeight);
    const key = focusKey ?? null;
    /* 到达前不能调用 onFocused，否则父层清掉 focusKey 会拆掉仍在等待的监听。 */
    let settle: ReturnType<typeof setTimeout>;
    let done = false;
    const onScroll = () => {
      if (Math.abs(el.scrollTop - top) < rowHeight) return arrived();
      clearTimeout(settle);
      settle = setTimeout(arrived, SETTLE_DELAY_MS);
    };
    const arrived = () => {
      if (done) return;
      done = true;
      clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
      setFlashKey(key);
      onFocused?.();
    };
    if (!reduced) el.addEventListener("scroll", onScroll, { passive: true });
    el.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    settle = setTimeout(arrived, reduced ? 0 : SETTLE_DELAY_MS);
    return () => {
      clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
    };
  }, [focusIndex, focusKey, onFocused, reduced]);

  useEffect(() => {
    if (!flashKey) return;
    const timer = setTimeout(() => setFlashKey(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashKey]);

  const empty = (
    <div className="text-sm leading-snug text-muted-foreground">
      No trophies yet for {name}
    </div>
  );

  if (!titles) {
    if (knownEmpty) return empty;
    if (loading) {
      return (
        <div role="status" aria-label="Loading trophies">
          <TrophySkeleton rows={rows} />
        </div>
      );
    }
    if (error) {
      return <div className="text-sm leading-snug text-muted-foreground">{error}</div>;
    }
    return empty;
  }
  if (!trophies?.length) return empty;

  return (
    <div {...(groups.length ? { "data-trophy-groups-wanted": "" } : {})}>
      <GroupSlot groups={groups} resetKey={trophies[0]?.key} />
      <TrophyViewport listRef={listRef}>
        {trophies.map((row, index) => (
          <div
            key={row.key}
            className={cn(
              "min-w-0 rounded-md",
              row.key === flashKey && (reduced ? "bg-surface-hover" : "animate-trophy-focus"),
            )}
          >
            <TrophyRow trophy={row.trophy} firstScreen={index < VISIBLE_ROWS} />
          </div>
        ))}
      </TrophyViewport>
    </div>
  );
}
