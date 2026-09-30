import { type ResolvedNowPlaying, type StoredWatchingItem } from "@/lib/emby-store";
import { publicAssetPath } from "@/lib/asset-url";
import type { WatchingItem } from "@/lib/types";

export type WatchingPayload = {
  items: WatchingItem[];
};

export type NowWatchingPayload = {
  nowPlaying: ResolvedNowPlaying | null;
  current: WatchingItem | null;
};

export function resolve(item: StoredWatchingItem, objectKeys: Record<string, string>): WatchingItem {
  const { posterKey, backdropKey, ...rest } = item;
  const posterObjectKey = posterKey ? objectKeys[posterKey] : null;
  const backdropObjectKey = backdropKey ? objectKeys[backdropKey] : null;
  return {
    ...rest,
    poster: posterObjectKey ? publicAssetPath(posterObjectKey) : null,
    backdrop: backdropObjectKey ? publicAssetPath(backdropObjectKey) : null,
  };
}

export function watchingPayload(
  items: StoredWatchingItem[],
  objectKeys: Record<string, string>,
  { limit = 8 } = {},
): WatchingPayload {
  return { items: items.slice(0, limit).map((item) => resolve(item, objectKeys)) };
}

export function nowWatchingPayload(
  live: ResolvedNowPlaying | null,
  current: StoredWatchingItem | null,
  objectKeys: Record<string, string>,
): NowWatchingPayload {
  if (!live) return { nowPlaying: null, current: null };
  return {
    nowPlaying: live,
    current: current?.id === live.itemId ? resolve(current, objectKeys) : null,
  };
}
