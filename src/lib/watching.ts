import type { WatchingItem } from "@/lib/types";

export function watchingIdentity(item: Pick<WatchingItem, "title" | "subtitle">): string {
  return `${item.title}\n${item.subtitle}`;
}

export function clampWatchProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

export function watchProgressLabel(progress: number): string | null {
  const rounded = Math.round(clampWatchProgress(progress));
  return rounded > 0 ? `${rounded}%` : null;
}

export type WatchRunStyle = {
  width: string;
  animationName?: "progress-run";
  animationDuration?: string;
  animationTimingFunction?: "linear";
  animationDelay?: string;
  animationFillMode?: "forwards";
  animationPlayState?: "paused" | "running";
};

// 减弱动效时全局把动画时长压到几乎为 0，progress-run 会停在 100%。
export function watchRunStyle(input: {
  progress: number;
  live: boolean;
  paused: boolean;
  positionMs: number | null;
  durationMs: number | null;
  reducedMotion: boolean;
}): WatchRunStyle {
  const width = `${Math.round(clampWatchProgress(input.progress))}%`;
  if (
    !input.live
    || input.reducedMotion
    || input.positionMs == null
    || !input.durationMs
  ) {
    return { width };
  }
  return {
    width,
    animationName: "progress-run",
    animationDuration: `${input.durationMs}ms`,
    animationTimingFunction: "linear",
    animationDelay: `-${input.positionMs}ms`,
    animationFillMode: "forwards",
    animationPlayState: input.paused ? "paused" : "running",
  };
}

export function currentWatchingItem(
  current: WatchingItem | null,
  items: readonly WatchingItem[],
  itemId: string | undefined,
): WatchingItem | null {
  if (current) return current;
  if (!itemId) return null;
  return items.find((item) => item.id === itemId) ?? null;
}

// Emby 合并项和播放文件的 ID 可不同；进度用续播记录，取最大值会掩盖回拖。
export function pinNowWatching(
  items: WatchingItem[],
  current: WatchingItem | null,
): WatchingItem[] {
  const pinned = current ? [current, ...items] : items;
  const out: WatchingItem[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of pinned) {
    const key = watchingIdentity(item);
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    if (current && out[existing].id === current.id) {
      out[existing] = { ...out[existing], progress: item.progress };
    }
  }
  return out;
}

export function isNowWatching(
  item: WatchingItem,
  nowPlayingId: string | undefined,
  current: WatchingItem | null,
): boolean {
  if (!nowPlayingId) return false;
  if (item.id === nowPlayingId) return true;
  return current != null && watchingIdentity(item) === watchingIdentity(current);
}
