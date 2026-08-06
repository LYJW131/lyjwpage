"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import type { ReactNode } from "react";

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

/** 单行高度（h-12 = 3rem），必须和 TrackRow 上的 class 一致 */
const ROW_HEIGHT = "3rem";
/** 列表窗口里显示几行 —— 取整数行，避免露出半行 */
const VISIBLE_ROWS = 4;

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
function SkeletonRow() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 px-2">
      <div className="size-9 shrink-0 animate-pulse rounded-sm bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
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
          高度用固定值而不是 max-height，条数多少都不影响。
        */}
        {(isLoading || rest.length > 0) && (
          // 边框和内边距放在外层，滚动容器本身不带 padding ——
          // 否则吸附位会被 padding 顶偏，还得再补 scroll-padding
          <div className="mt-3 border-t border-line pt-2">
            <div
              className={cn(
                "flex flex-col overflow-y-auto",
                // 吸附与防止滚动链外溢，和「最近在看」那一条保持一致
                "snap-y snap-mandatory scroll-smooth overscroll-y-contain",
                // 关掉滚动锚定：新条目插到顶部时，浏览器会为了「保持视觉位置不动」
                // 自动把 scrollTop 加一行，结果第一行被顶出可视区，得手动滑回去
                "[overflow-anchor:none]",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
              // 窗口高度取行高的整数倍，视图里永远是整数行
              style={{ height: `calc(${ROW_HEIGHT} * ${VISIBLE_ROWS})` }}
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
                      className="h-12 shrink-0 snap-start"
                    >
                      <TrackRow track={item} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                Array.from({ length: VISIBLE_ROWS }, (_, i) => (
                  <SkeletonRow key={i} />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
