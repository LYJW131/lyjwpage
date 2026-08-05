"use client";

import Image from "next/image";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
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
        <div className="truncate text-xs text-muted-foreground">{track.subtitle}</div>
      </div>
    </>
  );

  // 行高写死成 ROW_HEIGHT，容器高度才能取它的整数倍、不出现半行。
  // shrink-0 不能少：flex 子项默认会被 max-height 压扁，行会缩水、缩略图变形
  const className =
    "flex h-12 shrink-0 snap-start items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-surface-hover";

  return track.link ? (
    <a href={track.link} target="_blank" rel="noreferrer noopener" className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** 有链接就整块可点，没有就退化成普通容器 */
function HeroWrapper({ link, children }: { link: string | null; children: ReactNode }) {
  const className = "group flex gap-3 rounded-md";
  return link ? (
    <a href={link} target="_blank" rel="noreferrer noopener" className={className}>
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

  const [latest, ...rest] = data?.items ?? [];
  // 推断出来的「正在听」，且确实指向排在最前的这一项
  const playing = Boolean(data?.nowPlaying && data.nowPlaying.itemId === latest?.id);

  return (
    <Card label="Recently Played" action="Apple Music" className={className}>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {/* 最近的一项放大展示。整块都是链接 —— 点封面也能跳转 */}
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
                {isLoading ? "读取中…" : error ? "Apple Music 未连接" : "最近没有播放记录"}
              </div>
            )}
          </div>
        </HeroWrapper>

        {/* 再往前的几项。上游最多给 10 条，全部列出，放不下就滚动 */}
        {rest.length > 0 && (
          // 边框和内边距放在外层，滚动容器本身不带 padding ——
          // 否则吸附位会被 padding 顶偏，还得再补 scroll-padding
          <div className="mt-3 border-t border-line pt-2">
            <div
              className={cn(
                "flex flex-col overflow-y-auto",
                // 吸附与防止滚动链外溢，和「最近在看」那一条保持一致
                "snap-y snap-mandatory scroll-smooth overscroll-y-contain",
                "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              )}
              // 窗口高度取行高的整数倍，视图里永远是整数行
              style={{ maxHeight: `calc(${ROW_HEIGHT} * ${VISIBLE_ROWS})` }}
            >
              {rest.map((item, index) => (
                // 同一张专辑可能重复出现在列表里，key 必须带上下标
                <TrackRow key={`${item.id}-${index}`} track={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
