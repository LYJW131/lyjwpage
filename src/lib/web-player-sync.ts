import type { MediaItem } from "@/lib/musickit";
import { catalogItemId, mediaItemIndex } from "@/lib/playing-queue";
import { hostRewoundIntoTrack } from "@/lib/listen-along";

export const SYNC_RESYNC_THRESHOLD_MS = 5_000;
export const SYNC_TAIL_ECHO_MS = 7_000;

export function normalizeSyncUpcomingSongIds(
  ids: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  return (ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function queuedUpcomingSongIds(
  items: readonly MediaItem[] | null | undefined,
  currentSongId: string | null,
): string[] {
  if (!currentSongId) return [];
  const userItems = (items ?? []).filter((item) => !item.isAutoplay);
  const currentAt = mediaItemIndex(userItems, currentSongId);
  if (currentAt < 0) return [];
  return userItems
    .slice(currentAt + 1)
    .map((item) => catalogItemId(item.id))
    .filter((id): id is string => id !== null);
}

export type SyncQueueAction = "none" | "replace-upcoming" | "clear-upcoming";

export type SyncQueuePlan = {
  currentSongId: string | null;
  desiredSongIds: string[];
  queuedSongIds: string[];
  matches: boolean;
  action: SyncQueueAction;
};

// 队列比较必须保留重复曲目并核对长度，否则缩短队列后旧尾部仍会继续播放。
export function planSyncUpcomingQueue(
  items: readonly MediaItem[] | null | undefined,
  currentSongId: string | null,
  desiredSongIds: readonly (string | null | undefined)[] | null | undefined,
): SyncQueuePlan {
  const desired = normalizeSyncUpcomingSongIds(desiredSongIds);
  const queued = queuedUpcomingSongIds(items, currentSongId);
  const matches = currentSongId !== null &&
    queued.length === desired.length &&
    queued.every((id, index) => id === desired[index]);

  let action: SyncQueueAction = "none";
  if (currentSongId && !matches) {
    action = desired.length > 0 ? "replace-upcoming" : "clear-upcoming";
  }

  return {
    currentSongId,
    desiredSongIds: desired,
    queuedSongIds: queued,
    matches,
    action,
  };
}

export type NaturalNextSyncInput = {
  queueItems: readonly MediaItem[] | null | undefined;
  hostSongId: string | null;
  localSongId: string | null;
  hostPositionMs: number;
  hostDurationMs: number;
  tailMs?: number;
};

export function shouldKeepNaturalNext({
  queueItems,
  hostSongId,
  localSongId,
  hostPositionMs,
  hostDurationMs,
  tailMs = SYNC_TAIL_ECHO_MS,
}: NaturalNextSyncInput): boolean {
  if (!hostSongId || !localSongId || hostSongId === localSongId || hostDurationMs <= 0) return false;
  const items = (queueItems ?? []).filter((item) => !item.isAutoplay);
  const hostAt = mediaItemIndex(items, hostSongId);
  const localAt = mediaItemIndex(items, localSongId);
  if (hostAt < 0 || localAt <= hostAt) return false;
  return !hostRewoundIntoTrack(hostPositionMs, hostDurationMs, tailMs);
}

export type SyncEpoch = {
  generation: number;
  revision: number;
};

export function isSyncEpochCurrent(
  current: SyncEpoch,
  expected: SyncEpoch,
  syncing: boolean,
): boolean {
  return (
    syncing &&
    current.generation === expected.generation &&
    current.revision === expected.revision
  );
}
