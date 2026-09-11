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
  const device = describeDevice(nowPlaying.client, nowPlaying.deviceName);
  const chips = describeMedia(nowPlaying.media, nowPlaying.playMethod);

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

  return (
    <HeroWrapper link={item?.link ?? null} className="group flex gap-3 px-3 py-3 sm:gap-4">
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
        </div>
        <div className="truncate text-base font-medium leading-tight sm:text-lg" title={item?.title}>
          {item?.title ?? <span className="text-muted-foreground">读取详情…</span>}
        </div>
        <div className="truncate text-sm text-muted-foreground" title={item?.subtitle}>
          {item ? item.subtitle || "—" : "\u00a0"}
        </div>
        {/*
          规格标签和时间同一行、进度条单独在最下面：和站内其余进度条一样，文案在条
          的上方，不挂在条的右边。时间靠右，标签折行时它落在最后一行的末尾。
        */}
        <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1.5">
          {chips.length > 0 && (
            <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="播放规格">
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
            <span className="label-mono ml-auto shrink-0 normal-case tabular-nums text-muted-foreground">
              {formatClock(position)} / {formatClock(duration)}
            </span>
          ) : null}
        </div>
        {/*
          进度不压在剧照底边 —— 剧照有深有浅，压上去常常看不清；和「最近在听」hero
          同一支绿，暂停时整条灰掉。
        */}
        <div className="mt-1.5 h-0.75 overflow-hidden bg-muted" aria-hidden>
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
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? undefined : { height: 0, opacity: 0 }}
          transition={reduced ? STATIC_TRANSITION : LIST_TRANSITION}
          // 收起动画要 overflow-hidden，而 paper-card 的 3px 硬阴影在右下：这一层向右、
          // 向下各多出 3px，再用内距把阴影包进来，卡片本身仍和邻居同宽、右缘对齐，
          // 下一行的 12px 网格缝也不被这 3px 撑宽 —— 和「最近在看」那排瓷砖的滚动盒同一个办法
          className="-mb-[3px] -mr-[3px] overflow-hidden pb-[3px] pr-[3px] md:col-span-2"
        >
          <Card
            id="now-watching"
            label="Now Watching"
            // 卡头不点灯：在播 / 暂停已经写在里面的状态行上，进度条和秒针也在动
            action="Emby"
            className="scroll-mt-28"
          >
            <NowWatchingHero nowPlaying={nowPlaying} item={live?.current ?? null} />
          </Card>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
