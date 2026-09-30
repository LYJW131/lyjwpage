import type { LocalNowPlaying } from "@/lib/types";

export type PlaybackAnchor = Pick<
  LocalNowPlaying,
  "state" | "observedAt" | "positionMs" | "durationMs" | "repeatOne"
>;

export function trackPositionMs(track: PlaybackAnchor, now: number): number {
  const drift = track.state === "playing" ? Math.max(0, now - track.observedAt) : 0;
  const elapsed = track.positionMs + drift;
  if (track.durationMs <= 0) return elapsed;
  // 单曲循环时上游可能一直不推新锚点（曲目没变、状态没变），进度该绕回开头而
  // 不是钉在 100%；不循环时超出就 clamp，等下一条锚点纠正
  return track.repeatOne ? elapsed % track.durationMs : Math.min(track.durationMs, elapsed);
}
