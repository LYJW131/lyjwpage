import { currentMirror, type EmbyNowPlaying, imagesMirror, mirror, resumeMirror } from "@shared/emby-store";
import type { WatchingMedia, WatchingPlayMethod } from "@/lib/types";


export const TICKS_PER_MS = 10_000;

export type ResolvedNowPlaying = {
  itemId: string;
  paused: boolean;
  progress: number | null;
  client: string | null;
  deviceName: string | null;
  playMethod: WatchingPlayMethod | null;
  media: WatchingMedia | null;
  positionMs: number | null;
  durationMs: number | null;
};

export async function getNowPlaying(): Promise<ResolvedNowPlaying | null> {
  return resolveNowPlaying(await mirror.get());
}

export function resolveNowPlaying(state: EmbyNowPlaying | null): ResolvedNowPlaying | null {
  if (!state) return null;

  const playback = {
    client: state.client ?? null,
    deviceName: state.deviceName ?? null,
    playMethod: state.playMethod ?? null,
    media: state.media ?? null,
  };

  if (state.paused) {
    return {
      itemId: state.itemId,
      paused: true,
      progress: state.runTimeTicks
        ? clampPercent((state.positionTicks / state.runTimeTicks) * 100)
        : null,
      ...playback,
      positionMs: state.positionTicks / TICKS_PER_MS,
      durationMs: state.runTimeTicks ? state.runTimeTicks / TICKS_PER_MS : null,
    };
  }

  const elapsedTicks = (Date.now() - state.at) * TICKS_PER_MS;
  const projected = state.positionTicks + elapsedTicks;

  if (state.runTimeTicks && projected >= state.runTimeTicks) {
    return null;
  }

  return {
    itemId: state.itemId,
    paused: false,
    progress: state.runTimeTicks
      ? clampPercent((projected / state.runTimeTicks) * 100)
      : null,
    ...playback,
    positionMs: projected / TICKS_PER_MS,
    durationMs: state.runTimeTicks ? state.runTimeTicks / TICKS_PER_MS : null,
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export async function getResume() {
  return resumeMirror.get();
}

export async function getCurrentItem() {
  return currentMirror.get();
}

export async function getImageObjectKeys(): Promise<Record<string, string>> {
  return (await imagesMirror.get())?.objectKeys ?? {};
}
export { type EmbyNowPlaying, type StoredWatchingItem } from "@shared/emby-store";
