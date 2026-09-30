import type { WatchingItem } from "@/lib/types";

export function watchingIdentity(item: Pick<WatchingItem, "title" | "subtitle">): string {
  return `${item.title}\n${item.subtitle}`;
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
