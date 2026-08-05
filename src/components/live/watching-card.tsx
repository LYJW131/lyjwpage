"use client";

import Image from "next/image";

import { StatusDot } from "@/components/ui/status-dot";
import { useStatus } from "@/hooks/use-status";
import type { WatchingItem } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

/** 续播列表是小时级变化的，但正在播放的会话要跟手 */
const REFRESH_MS = 20_000;

/**
 * 卡片宽度按容器等分，保证视口里永远是整数张、不会被切一半。
 * 分母是列数，减掉的是列间的 gap-3（0.75rem）总宽：(列数 - 1) × 0.75rem。
 */
const TILE_WIDTH = cn(
  "shrink-0 snap-start",
  "basis-[calc((100%-0.75rem)/2)]",
  "md:basis-[calc((100%-1.5rem)/3)]",
  "lg:basis-[calc((100%-2.25rem)/4)]",
);

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
        "group relative flex flex-col overflow-hidden rounded-md",
        "border border-line bg-surface transition-colors hover:border-line-strong",
        TILE_WIDTH,
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

        {/* 进度条压在图片底边，所以颜色不能跟着主题走，也不能用黑白：
            海报有深有浅，只有绿色在两种底上都读得出来。
            正在播放时让它呼吸，暂停/没在播的就是静止的一条。 */}
        <div className="absolute inset-x-0 bottom-0 h-1">
          <div
            className={cn(
              "h-full bg-live transition-[width] duration-700",
              live && !paused && "[animation:progress-pulse_1.8s_ease-in-out_infinite]",
            )}
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
        <div className="label-mono mt-1 flex items-center justify-between gap-2 text-muted-foreground">
          <span>{Math.round(progress)}%</span>
          {/* 正在播的东西显示「2 小时前」没意义，两者互斥 */}
          {live ? (
            <span
              className={cn(
                "flex items-center gap-1.5",
                paused ? "text-live-idle" : "text-live",
              )}
            >
              <StatusDot tone={paused ? "idle" : "live"} />
              {paused ? "已暂停" : "正在播放"}
            </span>
          ) : (
            item.playedAt && <span>{timeAgo(item.playedAt)}</span>
          )}
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
            "overflow-hidden rounded-md border border-line bg-surface",
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
    // 吸附到卡片起始边，手动滑动也只会停在整卡边界上
    <div className="snap-x snap-mandatory overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
