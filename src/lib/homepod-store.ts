
import type { LocalNowPlaying } from "@/lib/types";
import { type StoredHomePod, mirror } from "@shared/homepod-store";

const UNKNOWN_DURATION_STALE_MS = 12 * 60 * 60 * 1000;

const SILENCE_GRACE_MS = 5 * 60 * 1000;

// 单曲循环不一定产生 HA 状态变化，不能用预计曲终时刻判定已停止。
const REPEAT_SILENCE_GRACE_MS = 30 * 60 * 1000;

export function playableHomePod(stored: StoredHomePod | null): StoredHomePod | null {
  if (!stored || stored.music.state === "stopped" || !stored.music.title) return null;
  return stored;
}

export async function getHomePodSnapshot() {
  return playableHomePod(await mirror.get());
}

export function homePodVisibleAt(
  stored: { music: LocalNowPlaying; receivedAt: number },
  now: number,
) {
  return now <= homePodVisibleUntil(stored);
}

export function homePodTrackEnd(stored: { music: LocalNowPlaying; receivedAt: number }): number | null {
  const { music, receivedAt } = stored;
  if (music.repeatOne || music.durationMs <= 0) return null;
  return receivedAt + Math.max(0, music.durationMs - music.positionMs);
}

export function homePodVisibleUntil(stored: { music: LocalNowPlaying; receivedAt: number }): number {
  const { music, receivedAt } = stored;
  if (music.repeatOne) return receivedAt + REPEAT_SILENCE_GRACE_MS;
  if (music.durationMs > 0) {
    const remaining = Math.max(0, music.durationMs - music.positionMs);
    return receivedAt + remaining + SILENCE_GRACE_MS;
  }
  return receivedAt + UNKNOWN_DURATION_STALE_MS;
}
export { type StoredHomePod } from "@shared/homepod-store";
