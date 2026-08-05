"use client";

import Image from "next/image";

import { StatusDot } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type { WatchingItem } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

/** 续播列表是小时级变化的，但正在播放的会话要跟手 */
const REFRESH_MS = 20_000;

type WatchingPayload = {
  items: WatchingItem[];
  nowPlaying: {
    itemId: string;
    paused: boolean;
    progress: number | null;
    device: string;
  } | null;
};

function Tile({
  item,
  live,
  paused,
  liveProgress,
}: {
  item: WatchingItem;
  live: boolean;
  paused: boolean;
  liveProgress: number | null;
}) {
  const progress = live && liveProgress != null ? liveProgress : item.progress;

  return (
    <a
      href={item.link ?? "#"}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "group relative flex w-[13.5rem] shrink-0 flex-col overflow-hidden rounded-md",
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

        {live && (
          <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-line bg-background/85 px-2 py-1 backdrop-blur-sm">
            <StatusDot tone={paused ? "idle" : "live"} />
            <span className="label-mono text-foreground">
              {paused ? "已暂停" : "正在播放"}
            </span>
          </span>
        )}

        {/* 进度条压在图片底边 */}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
          <div
            className={cn("h-full transition-[width] duration-700", live ? "bg-live" : "bg-foreground/70")}
            style={{ width: `${Math.round(progress)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <div className="truncate text-sm font-medium" title={item.title}>
          {item.title}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={item.subtitle}>
          {item.subtitle || "—"}
        </div>
        <div className="label-mono mt-1 flex items-center justify-between text-muted-foreground">
          <span>{Math.round(progress)}%</span>
          {item.playedAt && <span>{timeAgo(item.playedAt)}</span>}
        </div>
      </div>
    </a>
  );
}

function Skeleton() {
  return (
    <div className="flex gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="w-[13.5rem] shrink-0 overflow-hidden rounded-md border border-line bg-surface"
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
  );

  if (isLoading && !data) return <Skeleton />;

  if (error || !data?.items.length) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-line text-sm text-muted-foreground">
        {error ? "Emby 未连接" : "最近没有在追的内容"}
      </div>
    );
  }

  return (
    // 负 margin + padding 让卡片能滚到容器边缘之外，视觉上不被裁断
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex gap-3">
        {data.items.map((item) => {
          const live = data.nowPlaying?.itemId === item.id;
          return (
            <Tile
              key={item.id}
              item={item}
              live={live}
              paused={live ? Boolean(data.nowPlaying?.paused) : false}
              liveProgress={live ? (data.nowPlaying?.progress ?? null) : null}
            />
          );
        })}
      </div>
    </div>
  );
}
