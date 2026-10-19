"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import Image from "@/components/app-image";
import { appleArtwork, ARTWORK_SCALE, needsOptimizing, TRACK_ROW_ART_PX } from "@/lib/apple-artwork";
import type { ArtworkDataUri, ArtworkPlaceholders } from "@/lib/artwork-placeholder";
import { LIST_DURATION, LIST_ITEM_VARIANTS, LIST_TRANSITION, STATIC_TRANSITION, STATIC_VARIANTS } from "@/lib/motion";
import type { ListeningItem } from "@shared/types";
import { cn } from "@/lib/utils";

// 须与 src/app/styles/components.css 的 recent-tracks-track 行数上限对齐；实际行数按视口高度由容器查询决定。
const VISIBLE_ROWS = 4;
function TrackRow({
  track,
  placeholder,
  onOpen,
}: {
  track: ListeningItem;
  placeholder: ArtworkDataUri | undefined;
  onOpen?: () => void;
}) {
  const content = (
    <>
      <div className="relative size-11 shrink-0 overflow-hidden rounded-sm border border-line bg-muted">
        {placeholder && (
          <Image
            src={placeholder}
            alt=""
            aria-hidden
            fill
            sizes="44px"
            className="object-cover"
            decoding="sync"
          />
        )}
        {track.artwork && (
          <Image
            src={appleArtwork(track.artwork, TRACK_ROW_ART_PX * ARTWORK_SCALE)!}
            alt=""
            fill
            sizes="44px"
            className="object-cover"
            unoptimized={!needsOptimizing(track.artwork)}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {track.artist}
        </div>
      </div>
    </>
  );

  const className =
    "flex h-full items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover";

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(className, "w-full text-left")}
      >
        {content}
      </button>
    );
  }

  return track.link ? (
    <a
      href={track.link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
export function dedupeListeningItems(items: ListeningItem[], currentId: string | null) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (currentId && item.id === currentId) return false;
    if (!item.id) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
function SkeletonRow() {
  return (
    <div className="flex h-full items-center gap-2.5 px-2">
      <div className="size-11 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const UNSNAP_MS = LIST_DURATION * 1000 + 80;

function resetScroller(el: HTMLElement) {
  const saved = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  el.scrollTop = 0;
  el.scrollLeft = 0;
  el.style.scrollBehavior = saved;
}

function useRowSnap(topKey: string | undefined, wide: boolean) {
  const node = useRef<HTMLDivElement | null>(null);
  const previous = useRef(topKey);

  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    const el = node.current;
    if (!el || (el.scrollTop === 0 && el.scrollLeft === 0)) return;
    resetScroller(el);
  }, [topKey]);

  useIsomorphicLayoutEffect(() => {
    if (!node.current) return;
    resetScroller(node.current);
  }, [wide]);

  return useCallback((el: HTMLDivElement | null) => {
    node.current = el;
  }, []);
}
export function RecentTracks({
  rest,
  restKeys,
  wide,
  reduced,
  isLoading,
  artworkPlaceholders,
  canOpenInPlayer,
  openInPlayer,
}: {
  rest: ListeningItem[];
  restKeys: string[];
  wide: boolean;
  reduced: boolean | null;
  isLoading: boolean;
  artworkPlaceholders: ArtworkPlaceholders;
  canOpenInPlayer: (item: ListeningItem) => boolean;
  openInPlayer: (item: ListeningItem) => void;
}) {
  const listRef = useRowSnap(restKeys[0], wide);

  // popLayout 改变离场行定位，动画期间须关闭 scroll-snap，防止吸附目标跳动。
  const ids = restKeys.join("\n");
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
  // 空列表也须保留视口，否则客户端补数据时会撑高整行。
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-line pt-2">
      {/* 滚动内容不能参与网格的固有高度计算，否则整份列表会撑高卡片。 */}
      <div className="recent-tracks-viewport relative -mx-2 flex-1">
        <div
          ref={listRef}
          // Firefox / 部分 Safari 的滚动容器需要 tabindex 才能获得键盘焦点。
          tabIndex={0}
          role="region"
          aria-label="Recently played"
          className={cn(
            "absolute inset-0",
            "recent-tracks",
            wide && "is-wide",
            reflowing && "is-reflowing",
            "scroll-smooth",
            // 新条目插到顶部时，滚动锚定会自动推走第一行，因此关闭它。
            "[overflow-anchor:none]",
            "scrollbar-none [&::-webkit-scrollbar]:hidden",
          )}
        >
          <div className="recent-tracks-track">
            {rest.length > 0 ? (
              <AnimatePresence initial={false} mode="popLayout">
                {rest.map((item, index) => (
                  <motion.div
                    key={restKeys[index]}
                    layout={!reduced}
                    variants={reduced ? STATIC_VARIANTS : LIST_ITEM_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                    className="min-w-0 snap-start"
                  >
                    <TrackRow
                      track={item}
                      placeholder={
                        item.artwork
                          ? artworkPlaceholders.rows[item.artwork]
                          : undefined
                      }
                      onOpen={canOpenInPlayer(item) ? () => openInPlayer(item) : undefined}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : isLoading ? (
              Array.from({ length: VISIBLE_ROWS }, (_, i) => (
                <SkeletonRow key={i} />
              ))
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
