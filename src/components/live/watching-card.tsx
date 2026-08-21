"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { NOW_WATCHING_PATH, WATCHING_PATH } from "@/lib/paths";
import { stableKeys } from "@/lib/keys";
import {
  LIST_DURATION,
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import type { StatusResponse, WatchingItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 「正在看」的轮询，不分在播还是空闲。
 *
 * 开始/暂停/继续/停止由 Emby webhook 推来，拖进度条由 NAS 上的代理补推，
 * 这条只兜漏发。进度条是 CSS 动画从锚点自己跑的，跟这个间隔无关，所以在播时
 * 也没有调密的理由。
 */
const NOW_REFRESH_MS = 60_000;

/**
 * 列表变了（包括晚到的海报落地）会把完整数据推过来，轮询只兜「推送整体停用」
 * 这一种情况。从前是 60 秒，对齐代理的推送节奏 —— 那时列表根本不走推送。
 */
const LIST_REFRESH_MS = 10 * 60_000;

/**
 * 增删卡片后要等多久才把滚动吸附装回去。
 * 比动画本身多留一点，计时是动画开跑之后才起的。
 */
const UNSNAP_MS = LIST_DURATION * 1000 + 80;

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
};

type NowWatchingPayload = {
  nowPlaying: NowPlaying | null;
  /** 播放中那一项的详情，不一定在 items 里 —— 刚开播或已看完就会掉出 Resume */
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
  const progress = live && liveProgress != null ? liveProgress : item.progress;

  /**
   * 播放中时，进度条交给 CSS 动画逐帧走，不用 JS 计时器：
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
        "paper-card group relative flex h-full w-full flex-col overflow-hidden rounded-md",
        "border border-line-strong bg-surface",
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
            loading={eager ? "eager" : "lazy"}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            unoptimized
          />
        ) : null}

        {/* 压在封面右上角。海报底色不可控，所以垫一层模糊底片保证读得出来 */}
        {live && (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 border border-line bg-background/85 px-2 py-1 backdrop-blur-sm">
            <StatusDot tone={paused ? "idle" : "live"} />
            <span className="label-mono text-foreground">
              {paused ? "播放暂停" : "正在播放"}
            </span>
          </span>
        )}

        {/* 进度条压在图片底边，所以颜色不能跟着主题走，也不能用黑白：
            海报有深有浅，只有绿色在两种底上都读得出来。
            播放中时让它呼吸，暂停/没在播的就是静止的一条。 */}
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

export function WatchingRow({
  fallback,
  nowFallback,
}: {
  fallback: StatusResponse<WatchingPayload>;
  nowFallback: StatusResponse<NowWatchingPayload>;
}) {
  useLiveEvents();
  /**
   * 两个来源分开取，因为节奏差得远：列表是后端定时轮询 Emby 拿的，慢；
   * 正在播放由 webhook 推，快。合在一个端点时，慢的那半只能跟着快的那半
   * 一起被重取。
   */
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

  /**
   * 播放中那一项置顶并去重。
   *
   * 从前是服务端做的，拆成两个端点之后它做不了了 —— 两边各自刷新，服务端
   * 手上没有另一半。这本来也是展示逻辑，放这里更合适。
   */
  const data = (() => {
    if (!list) return undefined;
    const current = live?.current;
    const items = current
      ? [current, ...list.items.filter((item) => item.id !== current.id)]
      : list.items;
    return { items, nowPlaying: live?.nowPlaying ?? null };
  })();
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const nowPlayingId = data?.nowPlaying?.itemId;
  const firstItemId = data?.items[0]?.id;

  /**
   * 增删卡片的这一段时间里先把滚动吸附摘掉。
   *
   * 这一行是 scroll-snap 容器，往头部插卡片时浏览器会把「原本吸附住的那张」
   * 钉在原地不动：滚动位置一口气跳掉整整一格，新卡被顶到视口外，然后才被
   * 下面那个 scrollTo 平滑滚回来。于是进场是浏览器的滚动动画、离场是 motion
   * 的位移动画，快慢和曲线都对不上，离场收尾还要再被吸附纠正一次。
   * 动画期间没有吸附，两边就都只剩 motion 那一套。
   *
   * 代价是这 0.4 秒里手动滑动不吸附 —— 要正好在 Emby 推事件的同一瞬间滑，
   * 撞上了也只是松手时不停在整卡边界，不值得为它再加一层状态。
   */
  const ids = (data?.items ?? []).map((item) => item.id).join("\n");
  const [snappedIds, setSnappedIds] = useState(ids);
  const [reflowing, setReflowing] = useState(false);
  // 在 render 里改状态，这样摘掉吸附和插入卡片是同一次提交 ——
  // 放进 effect 就晚了一帧，浏览器已经先把滚动位置拽走了
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
    if (!nowPlayingId || firstItemId !== nowPlayingId) return;
    scrollerRef.current?.scrollTo({
      left: 0,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [firstItemId, nowPlayingId, reduced]);

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
    <div
      ref={scrollerRef}
      className={cn(
        "scroll-smooth overflow-x-auto overscroll-x-contain pb-1",
        "scrollbar-none [&::-webkit-scrollbar]:hidden",
        reflowing ? "snap-none" : "snap-x snap-mandatory",
      )}
    >
      <div className="relative flex gap-3">
        {/* popLayout 会把离场卡片临时绝对定位；relative 保证它留在滚动轨道内，
            后面的卡片才能一边补位、一边看着它平滑退场。 */}
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
