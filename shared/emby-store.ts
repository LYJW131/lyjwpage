import { mirrorKey } from "@/lib/storage";
import type { WatchingItem, WatchingMedia, WatchingPlayMethod } from "@/lib/types";

export const TTL_MS = 6 * 60 * 60 * 1000;

// 上报器按 FULL_PUSH_INTERVAL_MS（reporters/emby-reporter/src/config.ts）兜底整推续播列表；阈值取它的三倍，容忍连丢两次。
export const RESUME_STALE_MS = 30 * 60_000;

// 列表不随播放事件重推；不能套用会话 TTL，否则长期无播放会清空列表。
export const LIBRARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type EmbyNowPlaying = {
  itemId: string;
  paused: boolean;
  positionTicks: number;
  runTimeTicks: number;
  client: string | null;
  deviceName: string | null;
  playMethod: WatchingPlayMethod | null;
  media: WatchingMedia | null;
  at: number;
};

export const mirror = mirrorKey<EmbyNowPlaying>(["emby", "nowPlaying"], (state) => state.at, {
  ttlMs: TTL_MS,
});

// 图片可能晚于列表到达；持久化图片键才能让补图生效，无需重推列表。
export type StoredWatchingItem = Omit<WatchingItem, "poster" | "backdrop"> & {
  posterKey: string | null;
  backdropKey: string | null;
};

export const resumeMirror = mirrorKey<{ items: StoredWatchingItem[]; at: number }>(
  ["emby", "resume"],
  (state) => state.at,
  { ttlMs: LIBRARY_TTL_MS },
);

// webhook 只有播放状态，必须分开存详情，避免暂停或续播覆盖完整条目。
export const currentMirror = mirrorKey<{ item: StoredWatchingItem; at: number }>(
  ["emby", "current"],
  (state) => state.at,
  { ttlMs: TTL_MS },
);

export const imagesMirror = mirrorKey<{ objectKeys: Record<string, string>; at: number }>(
  ["emby", "images"],
  (state) => state.at,
  { ttlMs: LIBRARY_TTL_MS },
);
