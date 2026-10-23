import { takeDueRepurge, type RepurgeQueue } from "./lag-repurge";

// Workers Caching 的 purge 不论套餐都按 Free 档限流、全账号共用一个桶（出处见 docs/references.md「Workers Caching 的 purge 限流」）；
// 一轮失效要在 StatusSnapshot 与 RenderedSite 各清一次，间隔再短，两次清除就超过桶的补充速率，桶空后每次都被拒。
export const PURGE_MIN_INTERVAL_MS = 30_000;

export type PurgeState = { pending: string[]; lag: RepurgeQueue; flushedAt: number };

export type PurgePlan = { due: string[]; state: PurgeState; next: number | null };

export function purgeSlot(flushedAt: number, now: number): number {
  return Math.max(now, flushedAt + PURGE_MIN_INTERVAL_MS);
}

export function addPending(pending: readonly string[], tags: readonly string[]): string[] {
  return [...new Set([...pending, ...tags])];
}

export function planPurge(state: PurgeState, now: number): PurgePlan {
  const lag = takeDueRepurge(state.lag, now);
  const slot = purgeSlot(state.flushedAt, now);
  if (slot > now) {
    return { due: [], state, next: state.pending.length || lag.due.length ? slot : lag.next };
  }
  const due = addPending(state.pending, lag.due);
  if (!due.length) return { due, state, next: lag.next };
  return {
    due,
    state: { pending: [], lag: lag.rest, flushedAt: now },
    next: lag.next === null ? null : Math.max(lag.next, now + PURGE_MIN_INTERVAL_MS),
  };
}
