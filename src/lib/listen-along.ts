// 新曲起播期间的加载延迟不当作拖动偏差，否则会 seek 掉歌曲开头。

export function playbackLagMs(hostMs: number, localMs: number): number {
  return Math.max(0, hostMs - localMs);
}

export function followTargetMs(hostMs: number, lagMs: number): number {
  return Math.max(0, hostMs - lagMs);
}

// 单曲循环用环上距离；线性差值会在首尾交界误触 seek，与循环重启冲突。
export function loopDistanceMs(aMs: number, bMs: number, loopDurationMs: number): number {
  const straight = Math.abs(aMs - bMs);
  if (loopDurationMs <= 0) return straight;
  return Math.min(straight, Math.abs(loopDurationMs - straight));
}

export function needsResync(
  localMs: number,
  targetMs: number,
  thresholdMs: number,
  loopDurationMs = 0,
): boolean {
  return loopDistanceMs(localMs, targetMs, loopDurationMs) > thresholdMs;
}

export function shouldSeekAfterTrackChange(
  anchorPositionMs: number,
  thresholdMs: number,
): boolean {
  return anchorPositionMs > thresholdMs;
}

export function isHostSeek(
  localMs: number,
  lagMs: number,
  hostMs: number,
  thresholdMs: number,
  loopDurationMs = 0,
): boolean {
  return loopDistanceMs(localMs + lagMs, hostMs, loopDurationMs) > thresholdMs;
}

export function hostRewoundIntoTrack(
  hostMs: number,
  durationMs: number,
  tailMs: number,
): boolean {
  return durationMs > 0 && durationMs - hostMs > tailMs;
}
