
export const LAG_GRACE_MS = 15_000;
export const LAG_MIN_RETRY_MS = 15_000;
export const LAG_MAX_RETRY_MS = 5 * 60_000;
export const PUSH_SAFETY_NET_MS = 5 * 60_000;

export function lagOverdue(updatedAt: number | undefined, cadenceMs: number, now: number): boolean {
  return updatedAt == null || now >= updatedAt + cadenceMs + LAG_GRACE_MS;
}

export function fallbackOutlived(servedAt: number | undefined, intervalMs: number, now: number): boolean {
  return servedAt == null || now - servedAt >= intervalMs;
}

export function nextLagDelay(updatedAt: number | undefined, cadenceMs: number, now: number): number {
  if (updatedAt == null) return cadenceMs;
  const due = updatedAt + cadenceMs + LAG_GRACE_MS;
  if (due > now) return Math.max(1_000, due - now);
  const cap = Math.max(LAG_MIN_RETRY_MS, Math.min(cadenceMs, LAG_MAX_RETRY_MS));
  return Math.min(cap, Math.max(LAG_MIN_RETRY_MS, Math.round((now - due) / 2)));
}

export function realtimeInterval(cardMs: number, socketConnected: boolean, pushCovers: boolean): number {
  if (cardMs <= 0 || !socketConnected || !pushCovers) return cardMs;
  return Math.max(cardMs, PUSH_SAFETY_NET_MS);
}
