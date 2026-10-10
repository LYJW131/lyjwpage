// 一次采样再加计时抖动。再大就是拖动、换曲或循环，过渡会把进度条倒放。
const FORWARD_SAMPLE_SLACK = 1.75;

export function playbackProgressEases(
  previousPercent: number | null,
  nextPercent: number,
  durationMs: number,
  sampleMs: number,
): boolean {
  if (previousPercent == null || !(durationMs > 0) || !(sampleMs > 0)) return false;
  if (!Number.isFinite(previousPercent) || !Number.isFinite(nextPercent)) return false;
  const delta = nextPercent - previousPercent;
  if (delta < 0) return false;
  const samplePercent = (sampleMs / durationMs) * 100;
  return delta <= samplePercent * FORWARD_SAMPLE_SLACK;
}
