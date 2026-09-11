"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { NOW_WATCHING_PATH, WATCHING_PATH } from "@/lib/paths";
import { stableKeys } from "@/lib/keys";
import { splitNowWatching, watchingIdentity } from "@/lib/watching";
import { describeDevice, describeMedia } from "@/lib/watching-media";
import { formatClock } from "@/lib/web-player";
import {
  LIST_DURATION,
  LIST_TRANSITION,
  ROW_ITEM_VARIANTS,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import type { StatusResponse, WatchingItem, WatchingMedia, WatchingPlayMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 卡片锚点。跳转要滚到的也是它，所以这个 id 只写一处。 */
const ANCHOR = "watching";

/**
 * 「正在看」的轮询，不分在播还是空闲。
 *
 * 开始/暂停/继续/停止由 Emby webhook 推来，拖进度条由 NAS 上的代理补推，
 * 这条只兜漏发。进度是从锚点按真实时间自己往前推的，跟这个间隔无关，所以在播时
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
  client: string | null;
  deviceName: string | null;
  playMethod: WatchingPlayMethod | null;
  media: WatchingMedia | null;
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

/** 续播行里的一张：剧照、进度、两行字。播放中那一集不在这里，它有自己的一块 */
function Tile({ item, eager }: { item: WatchingItem; eager?: boolean }) {
  return (
    <a
      href={item.link ?? "#"}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        // 宽度和吸附交给外层的 motion 包装。嵌在卡片里的瓷砖和 PlayStation 那排
        // 同一套：细线、无硬阴影，纸片感留给外面那张卡
        "group relative flex h-full w-full flex-col overflow-hidden rounded-md",
        "border border-line bg-surface",
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

        {/* 进度条压在图片底边，海报有深有浅，黑白都会糊掉：用 --live 这支绿，
            它两套主题下各有一个值，压在海报上都读得出来。 */}
        <div className="absolute inset-x-0 bottom-0 h-1">
          <div
            className="h-full bg-live transition-[width] duration-700"
            style={{ width: `${Math.round(item.progress)}%` }}
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

/**
 * 播放中那一集单独放大的一块：剧照在左，右边是状态行（在哪放、走到哪）、标题、
 * 副标题和规格标签。和「最近在听」的 hero 同一个位置、同一种身份 —— 此刻的那一个
 * 不混在历史里。
 *
 * 进度从锚点按真实时间往前推：`positionMs` 是响应发出时的位置，浏览器以收到
 * 这份数据的那一刻为锚，不用管两台机器的时钟差。秒级计时器留在这个组件里，
 * 别放到外面 —— 下面那排带布局动画的瓷砖会跟着每秒重渲染一次。
 *
 * 首帧没有钟，服务端和 hydrate 那一遍都只画锚点、不往前推，两边算出来的必然
 * 一致；挂载之后才开始走。
 *
 * 看的是 nowPlaying 不是 current：详情比 webhook 晚到一拍，设备和规格跟着会话走，
 * 不该等它。详情没到时标题位先写「读取详情…」。
 */
function NowWatchingHero({
  nowPlaying,
  item,
}: {
  nowPlaying: NowPlaying;
  item: WatchingItem | null;
}) {
  const { paused } = nowPlaying;
  const device = describeDevice(nowPlaying.client, nowPlaying.deviceName);
  const chips = describeMedia(nowPlaying.media, nowPlaying.playMethod);

  /**
   * 秒针。锚点跟着这份数据走：SWR 只在内容变了才给新对象，每份新数据在下一次
   * tick 重新落锚，钟里记的是「哪份数据、第一次 tick 是几点、现在几点」。
   *
   * 不在渲染里读 Date.now()，也不在 effect 体里直接 setState —— 都是 lint 拦的。
   * 代价是第一秒只画锚点、不往前推，之后每秒一格；进度条上看不出这一秒。
   * 暂停时不走针，钟也不重落，位置就钉在锚点上。
   */
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
      className="group flex gap-3 border-b border-line px-3 py-3 sm:gap-4"
    >
      <div className="relative aspect-video w-32 shrink-0 self-start overflow-hidden rounded-md border border-line bg-muted sm:w-44 md:w-52">
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
        {/* 进度条压在剧照底边，理由同瓷砖。每秒走一格，线性过渡把格子之间抹平 */}
        <div className="absolute inset-x-0 bottom-0 h-1">
          <div
            className={cn("h-full bg-live", !paused && "transition-[width] duration-1000 ease-linear")}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone={paused ? "idle" : "live"} />
          <span className={cn("label-mono shrink-0", paused ? "text-muted-foreground" : "text-live")}>
            {paused ? "播放暂停" : "正在播放"}
          </span>
          {device && (
            <span className="label-mono min-w-0 truncate normal-case text-muted-foreground" title={device}>
              · {device}
            </span>
          )}
          {position != null && duration ? (
            <span className="label-mono ml-auto shrink-0 pl-2 normal-case tabular-nums text-muted-foreground">
              {formatClock(position)} / {formatClock(duration)}
            </span>
          ) : null}
        </div>
        <div className="truncate text-base font-medium leading-tight sm:text-lg" title={item?.title}>
          {item?.title ?? <span className="text-muted-foreground">读取详情…</span>}
        </div>
        <div className="truncate text-sm text-muted-foreground" title={item?.subtitle}>
          {item ? item.subtitle || "—" : " "}
        </div>
        {chips.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="播放规格">
            {chips.map((chip) => (
              <li
                key={chip}
                // label-mono 会把字母转大写，Dolby Vision / TrueHD / Mbps 这些名字
                // 大写了就不是它平时的样子，躲开
                className="label-mono border border-line px-1.5 py-1 normal-case text-muted-foreground"
              >
                {chip}
              </li>
            ))}
          </ul>
        )}
      </div>
    </HeroWrapper>
  );
}

/**
 * Emby「最近在看」整块：卡头、放大的「正在看」、续播瓷砖行收在同一张卡里，
 * 和上面那张 PlayStation 卡同一套骨架。从前这一段是一条分区标题加一排裸瓷砖，
 * 是首页唯一不成卡片的实时区。
 */
export function WatchingCard({
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
   * 播放中那一项拎出来放大，其余去重后铺成一排。
   *
   * 从前是服务端置顶的，拆成两个端点之后它做不了了 —— 两边各自刷新，服务端
   * 手上没有另一半。这本来也是展示逻辑，放这里更合适。
   */
  const nowPlaying = live?.nowPlaying ?? null;
  const { hero, rest } = splitNowWatching(
    list?.items ?? [],
    nowPlaying?.itemId,
    live?.current ?? null,
  );
  const reduced = useReducedMotion();
  const scrollerRef = useRef<HTMLDivElement>(null);

  /**
   * 增删卡片的这一段时间里先把滚动吸附摘掉。
   *
   * 这一行是 scroll-snap 容器，往头部插卡片时浏览器会把「原本吸附住的那张」
   * 钉在原地不动：滚动位置一口气跳掉整整一格，新卡被顶到视口外。于是进场是
   * 浏览器的滚动动画、离场是 motion 的位移动画，快慢和曲线都对不上，离场收尾
   * 还要再被吸附纠正一次。动画期间没有吸附，两边就都只剩 motion 那一套。
   *
   * 代价是这 0.4 秒里手动滑动不吸附 —— 要正好在 Emby 推事件的同一瞬间滑，
   * 撞上了也只是松手时不停在整卡边界，不值得为它再加一层状态。
   */
  const ids = rest.map(watchingIdentity).join("\n");
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

  // 对重排稳定的 key。用「同一部」而不是 Emby Id，不然 BD / WEB 切换会被
  // 当成一张退场、一张进场。
  const keys = stableKeys(rest.map(watchingIdentity));

  let body: ReactNode;
  if (isLoading && !list) {
    body = <Skeleton />;
  } else if ((error && !list) || (!rest.length && !nowPlaying)) {
    body = (
      <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {error && !list ? "Emby 未连接" : "最近没有在追的内容"}
      </div>
    );
  } else if (!rest.length) {
    // 只剩正在播的那一集：它已经在上面放大了，行里没有东西，不画空态
    body = null;
  } else {
    body = (
      <>
        {nowPlaying && (
          <div className="mb-2 label-mono text-muted-foreground">Continue Watching</div>
        )}
        {/* 吸附到卡片起始边，手动滑动也只会停在整卡边界上。
            overscroll-x-contain 很关键：不然横滑到头会把滚动链给外层，
            触发触控板的「滑动返回上一页」，那下手感是最生硬的。 */}
        <div
          ref={scrollerRef}
          // 独立滚动区：给它名字和角色，键盘也能直接聚上来用方向键横滚
          // （Firefox / 部分 Safari 不会让没有 tabindex 的滚动容器获得焦点）
          tabIndex={0}
          role="region"
          aria-label="继续观看"
          className={cn(
            "scroll-smooth overflow-x-auto overscroll-x-contain",
            "scrollbar-none [&::-webkit-scrollbar]:hidden",
            reflowing ? "snap-none" : "snap-x snap-mandatory",
          )}
        >
          <div className="relative flex w-full gap-3">
            {/* popLayout 会把离场卡片临时绝对定位；relative 保证它留在滚动轨道内，
                后面的卡片才能一边补位、一边看着它平滑退场。 */}
            <AnimatePresence initial={false} mode="popLayout">
              {rest.map((item, index) => (
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
                  <Tile item={item} eager={index < 4} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </>
    );
  }

  return (
    <Card
      id={ANCHOR}
      label="Recently Watched"
      // 卡头那盏灯跟播放走：在播绿、暂停黄、没在播不点。断流没有单独的档 ——
      // 这条链路全靠推送，服务端推算过片尾会自己把 nowPlaying 清成 null
      tone={nowPlaying ? (nowPlaying.paused ? "idle" : "live") : undefined}
      action="Emby"
      // 卡片网格是 gap-3，这块在网格外，间隔也得是同一个 12px
      className="mt-3 scroll-mt-28"
    >
      <AnimatePresence initial={false}>
        {nowPlaying ? (
          <motion.div
            key="watching-hero"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
            className="overflow-hidden"
          >
            <NowWatchingHero nowPlaying={nowPlaying} item={hero} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {body != null && <div className="px-3 pb-3 pt-3">{body}</div>}
    </Card>
  );
}
