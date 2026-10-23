import { PLAYBACK_STATE, type MusicKitInstance } from "@/lib/musickit";
import { catalogItemId, mediaItemIndex } from "@shared/playing-queue";
import { planSyncUpcomingQueue } from "@/lib/web-player-sync";

export function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown error";
}

export function isPlayInterrupted(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "AbortError") ||
    message.includes("interrupted by a new load request") ||
    message.includes("interrupted by a call to pause") ||
    /operation was aborted/i.test(message)
  );
}

export async function mkSafe(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (isPlayInterrupted(error)) return;
    throw error;
  }
}

export function isPlaybackActive(inst: MusicKitInstance): boolean {
  const s = inst.playbackState;
  return (
    s === PLAYBACK_STATE.playing ||
    s === PLAYBACK_STATE.loading ||
    s === PLAYBACK_STATE.waiting ||
    s === PLAYBACK_STATE.seeking
  );
}

export function localPositionMs(music: MusicKitInstance): number {
  const seconds = music.currentPlaybackTime;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
}

export function localSongId(music: MusicKitInstance): string | null {
  return catalogItemId(music.nowPlayingItem?.id);
}

export function waitUntilPlaying(
  music: MusicKitInstance,
  cancelled: () => boolean,
): Promise<void> {
  if (music.playbackState === PLAYBACK_STATE.playing) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      music.removeEventListener("playbackStateDidChange", onState);
      resolve();
    };
    const onState = () => {
      if (cancelled() || music.playbackState === PLAYBACK_STATE.playing) finish();
    };
    const timeout = window.setTimeout(finish, 25_000);
    const poll = window.setInterval(onState, 250);
    music.addEventListener("playbackStateDidChange", onState);
    onState();
  });
}

export function playSafe(music: MusicKitInstance): Promise<void> {
  return mkSafe(() => music.play());
}

export async function changeToSong(
  music: MusicKitInstance, songId: string, cancelled: () => boolean = () => false,
): Promise<void> {
  const at = mediaItemIndex(music.queue?.items ?? [], songId);
  if (at >= 0) {
    try {
      if (isPlaybackActive(music)) await mkSafe(() => music.pause());
      if (cancelled()) return;
      await music.changeToMediaAtIndex(at);
      return;
    } catch (error) {
      if (!isPlayInterrupted(error)) throw error;
    }
  }
  await mkSafe(() => music.stop());
  if (cancelled()) return;
  await mkSafe(() => music.setQueue({ song: songId }));
}

export async function syncUpcomingQueue(
  music: MusicKitInstance,
  ids: string[],
  cancelled: () => boolean,
): Promise<boolean> {
  const current = localSongId(music);
  const plan = planSyncUpcomingQueue(music.queue?.items, current, ids);
  const desired = plan.desiredSongIds;
  if (!current || plan.action === "none") return false;

  if (desired.length > 0) {
    await mkSafe(() => music.playNext({ song: desired[0] }, true));
    for (const id of desired.slice(1)) {
      if (cancelled()) return true;
      await mkSafe(() => music.playLater({ song: id }));
    }
    return true;
  }

  // MusicKit 无公开 clear-tail API；重装当前曲清尾时须恢复位置，避免取消同步后自由播放回到歌头。
  const position = localPositionMs(music);
  const wasLive = isPlaybackActive(music);
  await mkSafe(() => music.stop());
  if (cancelled()) return true;
  await mkSafe(() => music.setQueue({ song: current }));
  if (cancelled()) return true;
  if (wasLive) {
    await playSafe(music);
    await waitUntilPlaying(music, cancelled);
  }
  if (cancelled()) return true;
  if (position > 0) await mkSafe(() => music.seekToTime(position / 1000));
  return true;
}
