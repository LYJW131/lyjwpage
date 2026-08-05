"use client";

import Image from "next/image";

import { Card } from "@/components/ui/card";
import { useStatus } from "@/hooks/use-status";
import type { ListeningItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 与服务端 30s 列表缓存对齐 */
const REFRESH_MS = 30_000;

/**
 * 三根竖条，静止不动。
 *
 * 这里刻意不做跳动动效 —— 上游给的是「最近播放过的专辑/歌单」，
 * 并不代表此刻正在播，跳动的均衡器会假装成正在播放。
 */
function Bars() {
  const heights = ["h-2", "h-3", "h-1.5"];
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {heights.map((h, i) => (
        <span key={i} className={cn("w-[2px] rounded-full bg-muted-foreground", h)} />
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

  const className =
    "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover";

  return track.link ? (
    <a href={track.link} target="_blank" rel="noreferrer noopener" className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function ListeningCard({ className }: { className?: string }) {
  const { data, error, isLoading } = useStatus<ListeningItem[]>(
    "/api/status/listening",
    REFRESH_MS,
  );

  const [latest, ...rest] = data ?? [];

  return (
    // 不给状态灯：上游只知道「最近听过什么」，没有「正在播」这个状态可报
    <Card label="Recently Played" action="Apple Music" className={className}>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {/* 最近的一项放大展示 */}
        <div className="flex gap-3">
          <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-md border border-line bg-muted">
            {latest?.artwork ? (
              <Image
                src={latest.artwork}
                alt={`${latest.title} 封面`}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            {latest ? (
              <>
                <div className="flex items-center gap-2">
                  <Bars />
                  <span className="label-mono text-muted-foreground">最近听过</span>
                </div>
                <a
                  href={latest.link ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-medium leading-snug hover:underline"
                  title={latest.title}
                >
                  {latest.title}
                </a>
                <div className="truncate text-sm text-muted-foreground" title={latest.subtitle}>
                  {latest.subtitle}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {isLoading ? "读取中…" : error ? "Apple Music 未连接" : "最近没有播放记录"}
              </div>
            )}
          </div>
        </div>

        {/* 再往前的几项 */}
        {rest.length > 0 && (
          <div className="mt-3 flex flex-col border-t border-line pt-2">
            {rest.slice(0, 4).map((item, index) => (
              // 同一张专辑可能重复出现在列表里，key 必须带上下标
              <TrackRow key={`${item.id}-${index}`} track={item} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
