import type {
  MusicKitInstance,
  MusicKitMediaItem,
  MusicKitQueueOptions,
} from "@/lib/musickit";

export type PlayerRecord = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  url: string | null;
  songId?: string | null;
};

/** A catalog song is unambiguous; archive links also cover playlists and stations. */
export function playerQueue(record: PlayerRecord): MusicKitQueueOptions | null {
  if (record.songId) return { song: record.songId };
  if (!record.url) return null;
  try {
    const url = new URL(record.url);
    if (url.protocol !== "https:" || url.hostname !== "music.apple.com")
      return null;
    if (!/^\/[a-z]{2}\/(album|playlist|station|song)\//.test(url.pathname))
      return null;
    return { url: url.href };
  } catch {
    return null;
  }
}

export function playerTime(seconds: number): string {
  const at = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(at / 60);
  return `${minutes}:${String(at % 60).padStart(2, "0")}`;
}

export function boundedSeek(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0)
    return 0;
  return Math.max(0, Math.min(seconds, duration));
}

export function mediaTitle(
  item: MusicKitMediaItem | null | undefined,
  index = 0,
): string {
  return item?.attributes?.name || `曲目 ${index + 1}`;
}

export function playbackDuration(music: MusicKitInstance): number {
  const seconds = music.currentPlaybackDuration;
  if (seconds != null && Number.isFinite(seconds) && seconds > 0)
    return seconds;
  const ms = music.nowPlayingItem?.attributes?.durationInMillis;
  return ms != null && Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}

/** A stop invalidates queued work as well as async authorization already in flight. */
export function createPlaybackCommands() {
  let generation = 0;
  let tail = Promise.resolve();
  return {
    cancel() {
      generation += 1;
    },
    run(task: (cancelled: () => boolean) => Promise<void>) {
      const at = generation;
      const cancelled = () => generation !== at;
      const next = tail.then(async () => {
        if (!cancelled()) await task(cancelled);
      });
      tail = next.catch(() => {});
      return next;
    },
  };
}
