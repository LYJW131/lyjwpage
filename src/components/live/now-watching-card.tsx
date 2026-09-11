"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useStatus } from "@/hooks/use-status";
import { LIST_TRANSITION, STATIC_TRANSITION } from "@/lib/motion";
import { NOW_WATCHING_PATH } from "@/lib/paths";
import { describeDevice, describeMedia } from "@/lib/watching-media";
import { formatClock } from "@/lib/web-player";
import type { StatusResponse, WatchingItem, WatchingMedia, WatchingPlayMethod } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 「正在播放」的轮询。开始/暂停/继续/停止由 Emby webhook 推来，拖进度条由 NAS 上的
 * 代理补推，这条只兜漏发；和「最近在看」那排瓷砖问的是同一个键，SWR 会去重。
 */
const NOW_REFRESH_MS = 60_000;

/**
 * 展开 / 收起两态。高度之外把上边距（和上一个网格之间的 12px，即 gap-3）和
 * 抵消阴影内距的负边距也一起动画，收到 0 时整个盒子真的是 0 高，卸载不跳。
 *
 * 动画的这一层自己不带 padding：framer 量 `height: auto` 时会把 padding 算进去，
 * 再往 0 收就停在 padding 那 3px 上，卸载时跳一下。露阴影的内距放在里面一层。
 */
const EXPANDED = { height: "auto", opacity: 1, marginTop: 12, marginBottom: -3 };
const COLLAPSED = { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 };

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

type NowWatchingPayload = {
  nowPlaying: NowPlaying | null;
  /** 播放中那一项的详情，比 webhook 晚到一拍很正常 */
  current: WatchingItem | null;
};

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
 * 正在播的那一集：剧照在左，右边是状态行（在哪放）、标题、副标题和时间、单独一条
 * 进度、规格标签。和「最近在听」的 hero 同一个形状。
 *
 * 进度从锚点按真实时间往前推：`positionMs` 是响应发出时的位置，浏览器以收到这份
 * 数据的那一刻为锚，不用管两台机器的时钟差。秒级计时器留在这个组件里。
 *
 * 首帧没有钟，服务端和 hydrate 那一遍都只画锚点、不往前推，两边算出来的必然一致；
 * 挂载之后才开始走。
 *
 * 看的是 nowPlaying 不是 current：设备和规格跟着会话走，详情没到时标题位先写
 * 「读取详情…」，下一轮代理把详情推来就补上。
 */
function NowWatchingHero({
  nowPlaying,
  item,
}: {
  nowPlaying: NowPlaying;
  item: WatchingItem | null;
}) {
  const { paused } = nowPlaying;
  // 在哪放（客户端、设备各一个标签）和规格标签排在同一行，前两个打头
  const chips = [
    ...describeDevice(nowPlaying.client, nowPlaying.deviceName),
    ...describeMedia(nowPlaying.media),
  ];

  /**
   * 秒针。锚点跟着这份数据走：SWR 只在内容变了才给新对象，每份新数据在下一次
   * tick 重新落锚，钟里记的是「哪份数据、第一次 tick 是几点、现在几点」。
   *
   * 不在渲染里读 Date.now()，也不在 effect 体里直接 setState —— 都是 lint 拦的。
   * 代价是第一秒只画锚点、不往前推，之后每秒一格。暂停时不走针，位置钉在锚点上。
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

  /*
    两列网格：剧照一列、文字一列。窄屏（< 640px）剧照只跨第一行，旁边是状态行 /
    标题 / 副标题，规格标签、时间和进度条落到第二行、跨两列用整行 —— 并排时右边
    只剩不到 200px，五个标签折三行、时间挤成单独一行、进度条只有右半截。剧照不放大：
    Emby 给的剧照就 700 来像素宽，通栏到 3× 屏上会糊。sm 起剧照跨两行，右边仍是
    从前那一整列，桌面不变。
  */
  return (
    <HeroWrapper
      link={item?.link ?? null}
      // 右列文字行之间统一 6px（gap-y 和标题块的 gap 都是 1.5）；进度条前多留一些，见下面
      className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 py-3 sm:items-center sm:gap-x-4"
    >
      <div className="relative aspect-video w-32 shrink-0 self-start overflow-hidden rounded-md border border-line bg-muted sm:row-span-2 sm:w-44 md:w-52">
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
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1.5 self-center sm:self-end">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot tone={paused ? "idle" : "live"} />
          <span className={cn("label-mono shrink-0", paused ? "text-muted-foreground" : "text-live")}>
            {paused ? "播放暂停" : "正在播放"}
          </span>
        </div>
        <div className="truncate text-base font-medium leading-tight sm:text-lg" title={item?.title}>
          {item?.title ?? <span className="text-muted-foreground">读取详情…</span>}
        </div>
        <div className="truncate text-sm text-muted-foreground" title={item?.subtitle}>
          {item ? item.subtitle || "—" : "\u00a0"}
        </div>
      </div>

      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:self-start">
        {/*
          规格标签和时间同一行、进度条单独在最下面：和站内其余进度条一样，文案在条
          的上方，不挂在条的右边。时间靠右，标签折行时它落在最后一行的末尾。
        */}
        {/*
          标签和时间是同一个折行容器里的项：ul 用 `contents` 把 li 直接交给外层，
          标签折到第二行时时间就接在那一行的末尾，不再单独占一行。
        */}
        <div className="flex flex-wrap items-end gap-1.5">
          {chips.length > 0 && (
            <ul className="contents" aria-label="播放规格">
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
          {position != null && duration ? (
            <span className="label-mono ml-auto shrink-0 pl-1.5 normal-case tabular-nums text-muted-foreground">
              {formatClock(position)} / {formatClock(duration)}
            </span>
          ) : null}
        </div>
        {/*
          进度不压在剧照底边 —— 剧照有深有浅，压上去常常看不清；和「最近在听」hero
          同一支绿，暂停时整条灰掉。
        */}
        {/* 标签是带边框的盒子，和进度条之间要比文字行之间多留一点，不然条像贴在框上 */}
        <div className="mt-3 h-0.75 overflow-hidden bg-muted" aria-hidden>
          <div
            className={cn(
              "h-full",
              paused ? "bg-muted-foreground" : "bg-live transition-[width] duration-1000 ease-linear",
            )}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        </div>
      </div>
    </HeroWrapper>
  );
}

/**
 * Emby「正在播放」整张卡：只装此刻在播的那一集，占卡片网格第二行整行（充电卡和
 * 最近播放上面）；没在播就整个不渲染，网格里不留空行。续播列表另在下面「最近在看」
 * 那条分区里，和从前一样。
 */
export function NowWatchingCard({
  nowFallback,
}: {
  nowFallback: StatusResponse<NowWatchingPayload>;
}) {
  useLiveEvents();
  const { data: live } = useStatus<NowWatchingPayload>(NOW_WATCHING_PATH, NOW_REFRESH_MS, {
    fallback: nowFallback,
  });
  const reduced = useReducedMotion();
  const nowPlaying = live?.nowPlaying ?? null;

  return (
    <AnimatePresence initial={false}>
      {nowPlaying ? (
        <motion.div
          key="now-watching"
          initial={reduced ? false : COLLAPSED}
          animate={EXPANDED}
          exit={reduced ? undefined : COLLAPSED}
          transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
          // 收起动画要 overflow-hidden，而 paper-card 的 3px 硬阴影在右下：这一层向右
          // 多出 3px、里面一层再用内距包回来，卡片本身仍和邻居同宽、右缘对齐。下方
          // 那 3px 靠负边距抵消、和上一个网格之间的 12px 上边距，都写在 EXPANDED /
          // COLLAPSED 里跟着高度一起动画 —— 留在 className 里的话收到 0 时还剩
          // 这几个像素，卸载那一瞬会跳。
          className="-mr-[3px] overflow-hidden"
        >
          <div className="pb-[3px] pr-[3px]">
            <Card
              id="now-watching"
              label="Now Watching"
              // 卡头不点灯：在播 / 暂停已经写在里面的状态行上，进度条和秒针也在动
              action="Emby"
              className="scroll-mt-28"
            >
              <NowWatchingHero nowPlaying={nowPlaying} item={live?.current ?? null} />
            </Card>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
