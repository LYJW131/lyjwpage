import type { MediaItem } from "@/lib/musickit";
import { catalogItemId, mediaItemIndex } from "@/lib/playing-queue";
import { hostRewoundIntoTrack } from "@/lib/listen-along";

/** 同步队列和播放控制共用的误差窗口。 */
export const SYNC_RESYNC_THRESHOLD_MS = 5_000;
/** host 锚点落在尾部时，允许本地自然下一首先于旧事件继续播放。 */
export const SYNC_TAIL_ECHO_MS = 7_000;

/** 去掉无效 ID，但保留来源队列里的顺序和重复曲目。 */
export function normalizeSyncUpcomingSongIds(
  ids: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  return (ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** MusicKit 当前曲之后的用户队列；自动推荐项不参与同步契约。 */
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
  /**
   * `replace-upcoming` 可用 playNext(first, true) + playLater 重新排尾；
   * `clear-upcoming` 需要 setQueue({ song: current }) 清掉旧尾。
   */
  action: SyncQueueAction;
};

/**
 * 生成一次后续队列同步计划。
 *
 * 比 `every()` 多检查剩余长度：来源从两首缩成一首、或变为空时，旧尾巴不能
 * 留在 MusicKit 里继续播放。比较使用 catalogItemId，因此兼容 MusicKit 的 `i.`
 * 前缀；比较刻意保留重复曲目，它们在播放列表中是有意义的。
 */
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
  /** 默认 7 秒；小于该窗口表示 host 锚点仍可能是切歌前残影。 */
  tailMs?: number;
};

/**
 * 判断本地已经自然切到后续曲时，是否应该暂时保留本地曲目。
 *
 * 仅当两首歌都在同一队列且 local 在 host 后面，并且 host 锚点靠近上一首尾部时
 * 返回 true。host 真正拖回歌中间时 `hostRewoundIntoTrack` 返回 true，从而允许
 * 同步控制切回 host 曲。
 */
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

/**
 * 所有 await 之后的统一取消守卫。
 * generation 由用户播放控制 / 退出同步递增，revision 由 host 来源刷新递增。
 */
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
