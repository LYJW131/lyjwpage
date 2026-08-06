"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";

import { StatusDot } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import {
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import type { WatchingItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 播放状态变化由 Emby webhook → SSE 通知，这里是兜底轮询。
 * 但播放中要跟上 seek（Emby 不发 seek 事件），所以不能放太宽。
 */
const REFRESH_MS = 15_000;

/**
 * 卡片宽度按容器等分，保证视口里永远是整数张、不会被切一半。
 * 分母是列数，减掉的是列间的 gap-3（0.75rem）总宽：(列数 - 1) × 0.75rem。
 */
const TILE_WIDTH = cn(
  "basis-[calc((100%-0.75rem)/2)]",
  "md:basis-[calc((100%-1.5rem)/3)]",
  "lg:basis-[calc((100%-2.25rem)/4)]",
);

type NowPlaying = {
  itemId: string;
  paused: boolean;
  progress: number | null;
  device: string;
  positionMs: number | null;
  durationMs: number | null;
};

type WatchingPayload = {
  items: WatchingItem[];
  nowPlaying: NowPlaying | null;
};

function Tile({
  item,
  live,
  paused,
  liveProgress,
  positionMs,
  durationMs,
}: {
  item: WatchingItem;
  live: boolean;
  paused: boolean;
  liveProgress: number | null;
  positionMs: number | null;
  durationMs: number | null;
}) {
  const progress = live && liveProgress != null ? liveProgress : item.progress;

  /**
   * 正在播放时，进度条交给 CSS 动画逐帧走，不用 JS 计时器：
   * 动画本身是 0 → 100%、时长等于片长，再用负的 animation-delay
   * 把它定位到当前播放点。播放途中 Emby 不发事件、服务端也没有新数据可给，
   * 光靠拉取的话进度条会以轮询周期为步长一跳一跳。
   */
  const runStyle =
    live && positionMs != null && durationMs
      ? {
          animationName: "progress-run",
          animationDuration: `${durationMs}ms`,
          animationTimingFunction: "linear",
          animationDelay: `-${positionMs}ms`,
          animationFillMode: "forwards" as const,
          animationPlayState: (paused ? "paused" : "running") as "paused" | "running",
        }
      : { width: `${Math.round(progress)}%` };

  return (
    <a
      href={item.link ?? "#"}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        // 宽度和吸附交给外层的 motion 包装
        "group relative flex h-full w-full flex-col overflow-hidden rounded-md",
        "border border-line bg-surface transition-colors hover:border-line-strong",
        live && "border-live/40",
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-muted">
        {item.backdrop || item.poster ? (
          <Image
            src={(item.backdrop ?? item.poster)!}
            alt={item.title}
            fill
            sizes="216px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : null}

        {/* 压在封面右上角。海报底色不可控，所以垫一层模糊底片保证读得出来 */}
        {live && (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full border border-line bg-background/85 px-2 py-1 backdrop-blur-sm">
            <StatusDot tone={paused ? "idle" : "live"} />
            <span className="label-mono text-foreground">
              {paused ? "已暂停" : "正在播放"}
            </span>
          </span>
        )}

        {/* 进度条压在图片底边，所以颜色不能跟着主题走，也不能用黑白：
            海报有深有浅，只有绿色在两种底上都读得出来。
            正在播放时让它呼吸，暂停/没在播的就是静止的一条。 */}
        <div className="absolute inset-x-0 bottom-0 h-1">
          <div
            className={cn(
              "h-full bg-live",
              // 没在播时才用过渡，播放中由动画接管，两者叠加会打架
              !live && "transition-[width] duration-700",
            )}
            style={runStyle}
          />
        </div>
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
    </a>
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

export function WatchingRow() {
  const { data, error, isLoading } = useStatus<WatchingPayload>(
    "/api/status/watching",
    REFRESH_MS,
    "watching",
  );
  const reduced = useReducedMotion();
  // 对重排稳定的 key，否则列表顺序一变会被当成整批换新
  const keys = stableKeys((data?.items ?? []).map((item) => item.id));

  if (isLoading && !data) return <Skeleton />;

  if (error || !data?.items.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {error ? "Emby 未连接" : "最近没有在追的内容"}
      </div>
    );
  }

  return (
    // 吸附到卡片起始边，手动滑动也只会停在整卡边界上。
    // overscroll-x-contain 很关键：不然横滑到头会把滚动链给外层，
    // 触发触控板的「滑动返回上一页」，那下手感是最生硬的。
    <div className="snap-x snap-mandatory scroll-smooth overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-3">
        {/* popLayout 让离场的卡片脱离布局流，后面的能同时补位 */}
        <AnimatePresence initial={false} mode="popLayout">
          {data.items.map((item, index) => {
            const live = data.nowPlaying?.itemId === item.id;
            return (
              <motion.div
                key={keys[index]}
                layout={!reduced}
                variants={reduced ? STATIC_VARIANTS : ROW_ITEM_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
                // min-w-0 不能少：flex 子项的 min-width: auto 会取内容最小宽度，
                // 卡片里那行 nowrap 的长副标题会把 basis 顶开、宽度变得参差不齐
                className={cn("min-w-0 shrink-0 snap-start", TILE_WIDTH)}
              >
                <Tile
                  item={item}
                  live={live}
                  paused={live ? Boolean(data.nowPlaying?.paused) : false}
                  liveProgress={live ? (data.nowPlaying?.progress ?? null) : null}
                  positionMs={live ? (data.nowPlaying?.positionMs ?? null) : null}
                  durationMs={live ? (data.nowPlaying?.durationMs ?? null) : null}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
