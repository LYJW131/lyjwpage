export const HISTORY_BUCKET_MS = 900_000;

/**
 * 把稀疏的调用趋势按 15 分钟桶对齐到统一窗口，缺桶补零。
 *
 * Vercel 和 Workers 是两条独立缓存的端点，刷新时刻各走各的 15 分钟相位，
 * 窗口天然差一格；Vercel 的 history 还是 API 原样返回，空桶直接省略。
 * 四条线都按并集窗口过一遍这里，横轴起止和中间刻度就永远一致。
 */
export function alignHistory(
  points: { at: number; requests: number }[],
  start: number,
  end: number,
  bucketMs: number = HISTORY_BUCKET_MS,
): { at: number; requests: number }[] {
  const byBucket = new Map<number, number>();
  for (const point of points) {
    byBucket.set(Math.floor(point.at / bucketMs) * bucketMs, point.requests);
  }
  const first = Math.floor(start / bucketMs) * bucketMs;
  const result: { at: number; requests: number }[] = [];
  for (let at = first; at < end; at += bucketMs) {
    result.push({ at, requests: byBucket.get(at) ?? 0 });
  }
  return result;
}
