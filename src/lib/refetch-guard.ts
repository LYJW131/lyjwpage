/**
 * 同一个 SWR 键上的回源：别让两个消费者互相把对方的请求顶掉、再各自重问、无限循环，
 * 也别因此漏掉「该补的那一次」。
 *
 * 先说链是怎么成的（`lib/refetch-guard.test` 里有复现）：
 *
 * - 一个键有两个消费者（落地节点卡和 LYJWPAGE 卡都读 `server`）。首屏 HTML 放久了，两边
 *   各在挂载时补取一次。SWR 的无参 `mutate(key)` 不去重，两次都是新请求，后发的把先发的
 *   顶成「被丢弃」；
 * - `useStatus` 的 `onDiscarded` 为的是「回源途中被推送盖过」那种情形再问一次，对「被同一个
 *   键上另一条更晚发出的回源顶掉」也照问 —— 而那一条还在路上，结果照样会落地；这条新请求
 *   又把那一条顶成被丢弃；
 * - 两条请求各自完成、各自再问，又是两条并发的新请求，如此往复。只要有两条重叠，就永远
 *   有两条在路上：每个标签页每秒好几个请求，而且和页面可见与否无关。
 *
 * 只让「被丢弃」时别处还有请求在路上就不问，又会漏：在路上的那条要是失败了，没人再问，
 * 而 useStatus 关了错误重试、SWR 的轮询遇到缓存里的错误又会跳过，数据要一直等到重新聚焦。
 * 所以改成记账：
 *
 * - 被丢弃时先看有没有更新的回源已经落地 —— 有，这次丢弃不欠什么；没有，就记「欠一次补取」
 *   （欠的是被丢弃的那条的序号）；
 * - 之后落地（被 SWR 接受）的回源只要比欠的那条晚发出，就把这笔账清了；
 * - 这个键上所有在路上的回源都结束（成功、失败、卸载之后才回来都算）之后，账还欠着，
 *   就统一补一次，并且清账。补的这一次自己再被丢弃才会再欠一次，所以没有接力。
 *
 * 另外挂载补取按键去重：同一个键短时间内只放第一个消费者去补，另一个吃共享缓存里回来的那份，
 * 从源头少发一条重叠的请求。
 */

type KeyState = {
  /** 此刻在路上的回源条数 */
  pending: number;
  /** 已发出的最大序号 */
  issued: number;
  /** 最近结束的那条的序号（结果交给 SWR 之前出账时记下，SWR 紧接着判它被接受还是被丢弃） */
  finished: number;
  /** 被 SWR 接受、真正落进缓存的回源里最大的序号 */
  accepted: number;
  /** 被丢弃、还没有更晚的落地覆盖的回源里最大的序号；0 是不欠 */
  owed: number;
};

export function createRefetchLedger() {
  const states = new Map<string, KeyState>();
  const stateOf = (key: string): KeyState => {
    let state = states.get(key);
    if (!state) {
      state = { pending: 0, issued: 0, finished: 0, accepted: 0, owed: 0 };
      states.set(key, state);
    }
    return state;
  };

  return {
    /** 一条回源发出去。返回它的序号，结束时带回来 */
    begin(key: string): number {
      const state = stateOf(key);
      state.pending += 1;
      state.issued += 1;
      return state.issued;
    },
    /** 这条回源结束了（成功、失败、页面已卸载才回来，都算）。要在结果交给 SWR 之前调用 */
    end(key: string, seq: number): void {
      const state = stateOf(key);
      state.pending = Math.max(0, state.pending - 1);
      state.finished = seq;
    },
    /** SWR 判刚结束的那条被丢弃了 */
    discarded(key: string): void {
      const state = stateOf(key);
      // 更晚发出的那条已经落地：它的数据比这条新，丢了不欠什么
      if (state.accepted > state.finished) return;
      state.owed = Math.max(state.owed, state.finished);
    },
    /** SWR 判刚结束的那条被接受了 */
    accepted(key: string): void {
      const state = stateOf(key);
      state.accepted = Math.max(state.accepted, state.finished);
      // 落地的比欠的那条晚发出，那笔账已经被覆盖
      if (state.owed !== 0 && state.owed < state.finished) state.owed = 0;
    },
    /**
     * 这个键上没有回源在路上、又还欠着一次补取：清账并返回 true，调用方去补。
     * 要排在 SWR 判完「接受 / 丢弃」之后再调（结果处理是紧接着的微任务，排一个宏任务就够）。
     */
    settle(key: string): boolean {
      const state = stateOf(key);
      if (state.pending > 0 || state.owed === 0) return false;
      state.owed = 0;
      return true;
    },
  };
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
