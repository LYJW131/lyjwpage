/**
 * 轮询排期的纯函数，hooks/use-status 按它给 SWR 的 refreshInterval。
 *
 * 可滞后层：写入方按固定节奏写 KV（登记在 lib/status-views 的 `cadenceMs`），
 * 固定间隔轮询要么比写入快（白取同一份），要么慢（数据在 KV 里放着没人取）。
 * 所以下一次取排在「下一次预期写入」之后十几秒：`updatedAt + cadenceMs + 宽限`。
 * 那一刻已经过了（写入方漏了一轮、或者上报器本来就不规律）就按退避重试，直到
 * 取回更新的 `updatedAt`：先 15 秒，随逾期时长的一半增长，封顶 min(节奏, 5 分钟)。
 * 这样每分钟写一次的视图漏一轮最多 1 分钟一取，按小时报的圆环一夜没报也只是
 * 5 分钟一取（和从前固定轮询一样），不会狂刷。
 *
 * 实时层：推送连着时轮询只做兜底（5 分钟，但不比卡片自己的间隔更快），断开时
 * 回到卡片给的快间隔。能不能退成兜底由视图登记的 `pushCovers` 定。
 */

/**
 * 写入方写完到 KV 读得到之间的余量，也吸收采集任务自身几秒的耗时。实测（2026-09）
 * 每分钟一写的 vercel-deployments 新值在写入后 10–30 秒才从边缘读到，取 15 秒：
 * 多数时候一次取到，赶早了就按下面的 15 秒重试再取一次。
 */
export const LAG_GRACE_MS = 15_000;
export const LAG_MIN_RETRY_MS = 15_000;
export const LAG_MAX_RETRY_MS = 5 * 60_000;
/** 推送连着时实时视图的兜底轮询 */
export const PUSH_SAFETY_NET_MS = 5 * 60_000;

/** 首屏那份（或手上那份）是否已经过了下一次预期写入：挂载时据此决定要不要补取 */
export function lagOverdue(updatedAt: number | undefined, cadenceMs: number, now: number): boolean {
  return updatedAt == null || now >= updatedAt + cadenceMs + LAG_GRACE_MS;
}

/**
 * 距下一次取还要多少毫秒。`updatedAt` 缺省（信封不带、或降级信封）时按节奏本身取。
 */
export function nextLagDelay(updatedAt: number | undefined, cadenceMs: number, now: number): number {
  if (updatedAt == null) return cadenceMs;
  const due = updatedAt + cadenceMs + LAG_GRACE_MS;
  if (due > now) return Math.max(1_000, due - now);
  const cap = Math.max(LAG_MIN_RETRY_MS, Math.min(cadenceMs, LAG_MAX_RETRY_MS));
  return Math.min(cap, Math.max(LAG_MIN_RETRY_MS, Math.round((now - due) / 2)));
}

/**
 * 实时视图此刻的轮询间隔。`cardMs` 是卡片按数据给的间隔（0 = 停）。
 */
export function realtimeInterval(cardMs: number, socketConnected: boolean, pushCovers: boolean): number {
  if (cardMs <= 0 || !socketConnected || !pushCovers) return cardMs;
  return Math.max(cardMs, PUSH_SAFETY_NET_MS);
}
