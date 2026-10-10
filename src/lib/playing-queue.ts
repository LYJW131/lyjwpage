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

export const PRELOAD_AHEAD = 2;

export type PlayingQueueTrack = {
  title: string;
  artist: string | null;
  album: string | null;
};

export type PlayingQueue = {
  index: number | null;
  tracks: PlayingQueueTrack[];
};

export function normalizePlayingQueue(value: unknown): PlayingQueue | null {
  const row = object(value);
  if (!row || !Array.isArray(row.tracks)) return null;

  const tracks: PlayingQueueTrack[] = [];
  // index 是上报队列的原下标；丢掉没标题的行后仍按原下标对，否则当前首会滑到别的歌。
  const rawIndex = number(row.index);
  let index: number | null = null;
  for (let at = 0; at < row.tracks.length; at += 1) {
    const track = object(row.tracks[at]);
    const title = track ? text(track.title) : null;
    if (!title) continue;
    if (rawIndex === at) index = tracks.length;
    tracks.push({
      title,
      artist: track ? text(track.artist) : null,
      album: track ? text(track.album) : null,
    });
  }
  if (tracks.length === 0) return null;

  return { index, tracks };
}

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
