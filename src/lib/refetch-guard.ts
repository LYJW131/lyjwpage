/**
 * 同一个 SWR 键上的回源，别让两个消费者互相把对方的请求顶掉、再各自重问、无限循环。
 *
 * 先说链是怎么成的（2026-09 生产上 `/api/status/server` 实测，见 lib/refetch-guard.test）：
 *
 * - 一个键有两个消费者（落地节点卡和 LYJWPAGE 卡都读 `server`）。首屏那份放久了，两边
 *   各在挂载时补取一次。SWR 的无参 `mutate(key)` 不去重，两次都是新请求，后发的那条
 *   把先发的顶成「被丢弃」；
 * - `useStatus` 的 `onDiscarded` 为的是「回源途中被推送盖过」那一种，被丢了就再问一次。
 *   可它对「被另一条更晚发出的回源顶掉」也一视同仁地再问 —— 而那条更晚的还在路上，
 *   结果照样会落地，再问纯属多余，并且这条新请求又把那条「更晚的」顶成被丢弃；
 * - 两条请求各自完成、各自触发重问，又是两条并发的新请求，如此往复。只要有两条重叠，
 *   就永远有两条在路上：往返 450 ms 时每个标签页每秒约四五个请求，而且和页面可见与否
 *   无关，后台标签页也一直发。
 *
 * 所以两道闸：
 *
 * 1. 被丢弃时先看这个键上还有没有别的回源在路上：有，就不再问（在路上的那条自己会
 *    交结果，它要是也被推送盖了，轮到它被丢弃时会再问）；没有，才是被推送盖过，
 *    再问一次，和从前一样。
 * 2. 挂载补取按键去重：同一个键短时间内只放第一个消费者去补取，另一个消费者吃共享
 *    缓存里回来的那份。
 */

/** 每个键上此刻在路上的回源条数 */
export function createInflightLedger() {
  const pending = new Map<string, number>();
  return {
    begin(key: string): void {
      pending.set(key, (pending.get(key) ?? 0) + 1);
    },
    end(key: string): void {
      const left = (pending.get(key) ?? 0) - 1;
      if (left > 0) pending.set(key, left);
      else pending.delete(key);
    },
    pending(key: string): number {
      return pending.get(key) ?? 0;
    },
  };
}

/**
 * 一次回源被 SWR 丢弃之后，要不要再问一次。`pendingOthers` 是这个键上除了刚落地
 * 的这条之外，还有几条在路上（落地的那条在结果交给 SWR 之前已经出账）。
 */
export function shouldReaskAfterDiscard(pendingOthers: number): boolean {
  return pendingOthers === 0;
}

/** 挂载补取的去重窗口，取 SWR 默认的 dedupingInterval */
export const MOUNT_REFETCH_DEDUPE_MS = 2_000;

/** 同一个键 `windowMs` 内只让第一个来领的消费者补取 */
export function createMountRefetchGate(windowMs = MOUNT_REFETCH_DEDUPE_MS) {
  const last = new Map<string, number>();
  return {
    claim(key: string, now: number): boolean {
      const previous = last.get(key);
      if (previous !== undefined && now - previous < windowMs) return false;
      last.set(key, now);
      return true;
    },
  };
}
