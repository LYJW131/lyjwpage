"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import { stableKeys } from "@/lib/keys";
import {
  HERO_VARIANTS,
  LIST_ITEM_VARIANTS,
  LIST_TRANSITION,
  STATIC_TRANSITION,
  STATIC_VARIANTS,
} from "@/lib/motion";
import type { ListeningItem, ListeningPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 与服务端 30s 列表缓存对齐 */
const REFRESH_MS = 30_000;

/**
 * 单行的最小高度。行高不是写死的：列表会填满卡片剩下的空间，
 * 再把这段空间等分成整数行 —— 见 useRowMetrics。
 * 36px 封面 + 上下留白，比这个再矮就挤了。
 */
const MIN_ROW_HEIGHT_PX = 48;
/** 至少留出这么多行的位置，避免卡片在极端布局下塌成一条缝 */
const MIN_ROWS = 4;

/** 三根竖条。推断为正在播时跳动，否则静止成一个普通的音乐小图标 */
function Bars({ active }: { active: boolean }) {
  const idleHeights = ["h-2", "h-3", "h-1.5"];
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] origin-bottom rounded-full",
            active ? "h-full bg-live" : `bg-muted-foreground ${idleHeights[i]}`,
          )}
          style={
            active
              ? {
                  animation: `equalizer ${0.9 + i * 0.25}s ease-in-out ${i * 0.15}s infinite`,
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

function TrackRow({ track }: { track: ListeningItem }) {
  const content = (
    <>
      <div className="relative size-9 shrink-0 overflow-hidden rounded-sm border border-line bg-muted">
        {track.artwork && (
          <Image
            src={track.artwork}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{track.title}</div>
        {/* 用 subtitle 而不是 artist —— 它带着「专辑 / 歌单」的类型信息 */}
        <div className="truncate text-xs text-muted-foreground">
          {track.subtitle}
        </div>
      </div>
    </>
  );

  // 高度和吸附交给外层的 motion 包装，这里只管行内布局
  const className =
    "flex h-full items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover";

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

/** 占位行，高度必须和 TrackRow 一致，否则加载完照样会跳 */
function SkeletonRow({ height }: { height: number }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2.5 px-2"
      style={{ height: `${height}px` }}
    >
      <div className="size-9 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

// 服务端没有 layout 阶段，useLayoutEffect 会告警，这里按环境切换
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * 让列表填满卡片剩下的高度，并把这段高度等分成整数行。
 *
 * 两张卡在同一 grid 行里、被拉成等高，而这张卡的内容比充电头矮 ——
 * 行高写死的话，多出来的十几二十像素就摊在列表底下变成一块空白。
 * 但也不能让列表直接撑满：那会在底部露出半行（实测 17px 的一条）。
 *
 * 所以量出可用高度，取能放下的整行数，再把高度平摊回每一行：
 * 行高从 48px 起浮动几像素，视口怎么变，底部都是齐的、也永远是整行。
 */
function useRowMetrics() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(MIN_ROW_HEIGHT_PX);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const available = entry.contentRect.height;
      if (available < MIN_ROW_HEIGHT_PX) return;
      const rows = Math.max(1, Math.floor(available / MIN_ROW_HEIGHT_PX));
      const next = available / rows;
      // 亚像素抖动会引起无限的「量→改→再量」循环，差得够多才写回
      setRowHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { hostRef, rowHeight };
}

/** 用户停止滚动后多久开始对齐 */
const SETTLE_DELAY_MS = 110;
/** 数据变化后这段时间内不做对齐，等重排动画落定 */
const SUSPEND_AFTER_CHANGE_MS = 500;

/**
 * 保证列表永远停在整行上，同时不和重排动画打架。
 *
 * 没有用 CSS 的 scroll-snap：它会在数据变化时重新计算吸附目标，而 popLayout
 * 会把离场元素改成绝对定位、容器高度剧变，导致吸附算飞 —— 实测 scrollTop
 * 会被弹到 48 甚至 192。「动画期间临时关掉吸附」也不行，装回去的那一刻
 * 动画还没落定，照样被吸走。
 *
 * 所以自己做：只在「用户滚动停下来之后」对齐到最近的整行，
 * 并且在数据变化后的动画窗口内跳过。浏览器不再有插手的机会。
 */
function useRowSnap(rowHeight: number, topKey: string | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(topKey);
  const suspendUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 顶部换人：拉回顶端，并在动画期间挂起对齐
  useIsomorphicLayoutEffect(() => {
    if (previous.current === topKey) return;
    previous.current = topKey;
    suspendUntil.current = Date.now() + SUSPEND_AFTER_CHANGE_MS;

    const el = ref.current;
    if (!el || el.scrollTop === 0) return;
    // 临时关掉 scroll-smooth，否则会看到「先跳一下再滑回来」
    const saved = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = 0;
    el.style.scrollBehavior = saved;
  }, [topKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (Date.now() < suspendUntil.current) return;
        const target = Math.round(el.scrollTop / rowHeight) * rowHeight;
        // 已经对齐就别再滚，否则自己触发的 scroll 会来回抖
        if (Math.abs(target - el.scrollTop) < 0.5) return;
        el.scrollTo({ top: target, behavior: "smooth" });
      }, SETTLE_DELAY_MS);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [rowHeight]);

  return ref;
}

/** 有链接就整块可点，没有就退化成普通容器 */
function HeroWrapper({
  link,
  children,
}: {
  link: string | null;
  children: ReactNode;
}) {
  const className = "group flex gap-3 rounded-md";
  return link ? (
    <a
      href={link}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
    >
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function ListeningCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ListeningPayload>(
    "/api/status/listening",
    REFRESH_MS,
  );

  const reduced = useReducedMotion();

  const [latest, ...rest] = data?.items ?? [];
  // 推断出来的「正在听」，且确实指向排在最前的这一项
  const playing = Boolean(
    data?.nowPlaying && data.nowPlaying.itemId === latest?.id,
  );
  // 对重排稳定的 key，否则顶部插入新条目时会被当成整批换新
  const restKeys = stableKeys(rest.map((item) => item.id));
  const { hostRef, rowHeight } = useRowMetrics();
  const listRef = useRowSnap(rowHeight, restKeys[0]);

  return (
    <Card label="Recently Played" action="Apple Music" className={className}>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {/* 最近的一项放大展示。整块都是链接 —— 点封面也能跳转。
            换专辑/歌单时整块交叉淡入，不硬跳 */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={latest?.id ?? "empty"}
            variants={reduced ? STATIC_VARIANTS : HERO_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={
              reduced ? STATIC_TRANSITION : { duration: 0.22, ease: "easeOut" }
            }
          >
            <HeroWrapper link={latest?.link ?? null}>
              <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border border-line bg-muted">
                {latest?.artwork ? (
                  <Image
                    src={latest.artwork}
                    alt={`${latest.title} 封面`}
                    fill
                    sizes="80px"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    unoptimized
                  />
                ) : null}
              </div>

              {/*
            不用统一的 gap：三行的行内 leading 不一样（标签行盒高贴合文字，
            标题和副标题各自还有 3px 内部余白），统一 gap 会让视觉间隙一宽一窄。
            这里按实测的 leading 差额补偿，让两处视觉间隙都落在 8px 左右。
          */}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                {latest ? (
                  <>
                    {/* 图标在左、文字在右，和 CHARGER / C1 那些标签行一致：
                    对齐的是图标的左边界，标签文字本身缩进 */}
                    <div className="flex items-center gap-1.5">
                      <Bars active={playing} />
                      <span
                        className={cn(
                          "label-mono",
                          playing ? "text-live" : "text-muted-foreground",
                        )}
                      >
                        {playing ? "正在播放" : "最近听过"}
                      </span>
                    </div>
                    <div
                      className="mt-1 truncate font-medium leading-snug group-hover:underline"
                      title={latest.title}
                    >
                      {latest.title}
                    </div>
                    <div
                      className="mt-px truncate text-sm text-muted-foreground"
                      title={latest.subtitle}
                    >
                      {latest.subtitle}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {isLoading
                      ? "读取中…"
                      : error
                        ? "Apple Music 未连接"
                        : "最近没有播放记录"}
                  </div>
                )}
              </div>
            </HeroWrapper>
          </motion.div>
        </AnimatePresence>

        {/*
          再往前的几项。上游最多给 10 条，全部列出，放不下就滚动。

          加载中也要把这块的位置占住（渲染骨架行），否则卡片会先矮一截、
          数据到了再撑高 —— 两张卡在同一 grid 行里，会一起跳。
          这块吃掉卡片剩下的全部高度，行高由 useRowMetrics 平摊，
          所以底部不会留空，也不会露出半行。
        */}
        {(isLoading || rest.length > 0) && (
          // 边框和内边距放在外层，滚动容器本身不带 padding ——
          // 否则吸附位会被 padding 顶偏，还得再补 scroll-padding
          // min-h-0 不能少：flex 子项默认 min-height:auto，会被内容撑破而不是滚动
          <div className="mt-3 flex flex-1 flex-col border-t border-line pt-2">
            {/*
              滚动容器绝对定位，是为了让它对「这张卡有多高」完全没有发言权。
              grid 行按 max-content 定高：让它参与的话，10 条 × 行高会被当成
              卡片的固有高度，整个「此刻」区块被撑到近两倍（实测 364 → 588）。
              绝对定位的子元素不参与固有尺寸计算，卡片高度就还是由充电头那张
              决定，这里只负责把分到的空间填满。min-height 是这块唯一的话语权。
            */}
            <div
              ref={hostRef}
              className="relative flex-1"
              style={{ minHeight: `${MIN_ROW_HEIGHT_PX * MIN_ROWS}px` }}
            >
              <div
                ref={listRef}
                className={cn(
                  "absolute inset-0 flex flex-col overflow-y-auto",
                  // 这里刻意不做 scroll-snap。它会和 framer 的 layout 动画打架：
                  // popLayout 把离场元素改成绝对定位，容器高度剧变，吸附目标算飞，
                  // 实测新条目进来时 scrollTop 会被弹到 48 甚至 192 再慢慢滑回。
                  // 整数行是靠「容器高度正好等于行高整数倍」保证的，不需要吸附。
                  "scroll-smooth overscroll-y-contain",
                  // 关掉滚动锚定：新条目插到顶部时，浏览器会为了「保持视觉位置不动」
                  // 自动把 scrollTop 加一行，结果第一行被顶出可视区，得手动滑回去
                  "[overflow-anchor:none]",
                  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                )}
              >
                {rest.length > 0 ? (
                  // popLayout 让离场的行脱离布局流，剩下的能同时补位而不是等它消失
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
                        className="shrink-0"
                        style={{ height: `${rowHeight}px` }}
                      >
                        <TrackRow track={item} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                ) : (
                  Array.from({ length: MIN_ROWS }, (_, i) => (
                    <SkeletonRow key={i} height={rowHeight} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
