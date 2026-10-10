
import type { LocalNowPlaying } from "@/lib/types";
import { type StoredHomePod, mirror } from "@shared/homepod-store";

const UNKNOWN_DURATION_STALE_MS = 12 * 60 * 60 * 1000;

export const SILENCE_GRACE_MS = 5 * 60 * 1000;

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

// positionMs 是 observedAt 那一刻的进度。播放中曲终从 observedAt 起算剩余时长；
// 上报晚到时不能从 receivedAt 把剩余再放一遍。暂停时进度冻结，剩余从收到时刻算。
function playheadAnchor(music: LocalNowPlaying, receivedAt: number): number {
  if (music.state !== "playing") return receivedAt;
  const observed = music.observedAt;
  if (!Number.isFinite(observed) || observed <= 0 || observed > receivedAt) return receivedAt;
  return observed;
}

export function homePodTrackEnd(stored: { music: LocalNowPlaying; receivedAt: number }): number | null {
  const { music, receivedAt } = stored;
  if (music.repeatOne || music.durationMs <= 0) return null;
  return playheadAnchor(music, receivedAt) + Math.max(0, music.durationMs - music.positionMs);
}

export function homePodVisibleUntil(stored: { music: LocalNowPlaying; receivedAt: number }): number {
  const { music, receivedAt } = stored;
  if (music.repeatOne) return receivedAt + REPEAT_SILENCE_GRACE_MS;
  if (music.durationMs > 0) {
    const end = homePodTrackEnd(stored);
    return (end ?? receivedAt) + SILENCE_GRACE_MS;
  }
  return receivedAt + UNKNOWN_DURATION_STALE_MS;
}
export { type StoredHomePod } from "@shared/homepod-store";
