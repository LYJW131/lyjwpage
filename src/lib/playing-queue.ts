function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Music.app 的 Playing Next。
 *
 * 上报器读的是资料库旁那份没有文档的 Queue.dat，整份带 beta。站点只拿
 * 「当前曲后面两首」去做目录查询，不把整队原样推给浏览器。
 */
export const PRELOAD_AHEAD = 2;

export type PlayingQueueTrack = {
  title: string;
  artist: string | null;
  album: string | null;
  /** Music.app persistent ID，不是目录 songId。目录 ID 要现搜 */
  trackId: string | null;
};

export type PlayingQueue = {
  index: number | null;
  tracks: PlayingQueueTrack[];
};

function trackIdOf(row: Record<string, unknown>) {
  // 上报器 Codable 键是 trackID；站点对外一律 trackId
  return text(row.trackId) ?? text(row.trackID);
}

export function normalizePlayingQueue(value: unknown): PlayingQueue | null {
  const row = object(value);
  if (!row || !Array.isArray(row.tracks)) return null;

  const tracks: PlayingQueueTrack[] = [];
  for (const item of row.tracks) {
    const track = object(item);
    const title = track ? text(track.title) : null;
    if (!title) continue;
    tracks.push({
      title,
      artist: track ? text(track.artist) : null,
      album: track ? text(track.album) : null,
      trackId: track ? trackIdOf(track) : null,
    });
  }
  if (tracks.length === 0) return null;

  const rawIndex = number(row.index);
  const index =
    rawIndex != null && Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < tracks.length
      ? rawIndex
      : null;

  return { index, tracks };
}

/**
 * 当前曲后面那几首。index 对不上时，只有标题在队列里唯一才敢猜位置。
 */
export function upcomingQueueTracks(
  queue: PlayingQueue | null,
  currentTitle: string | null,
  ahead = PRELOAD_AHEAD,
): PlayingQueueTrack[] {
  if (!queue || ahead <= 0) return [];

  let index = queue.index;
  if (index == null) {
    if (!currentTitle) return [];
    const hits = queue.tracks.flatMap((track, at) => (track.title === currentTitle ? [at] : []));
    if (hits.length !== 1) return [];
    index = hits[0];
  }

  return queue.tracks.slice(index + 1, index + 1 + ahead);
}

/** MusicKit 条目 ID 有时带 `i.` 前缀，目录 songId 没有 */
export function catalogItemId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.replace(/^i\./, "");
}

export function mediaItemIndex(
  items: Array<{ id?: string } | null | undefined>,
  songId: string,
): number {
  return items.findIndex((item) => catalogItemId(item?.id) === songId);
}
