// SWR 的无参 mutate 不去重；多个消费者补取会互相丢弃并形成无限重取链。

type KeyState = {
  pending: number;
  issued: number;
  finished: number;
  accepted: number;
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
    begin(key: string): number {
      const state = stateOf(key);
      state.pending += 1;
      state.issued += 1;
      return state.issued;
    },
    end(key: string, seq: number): void {
      const state = stateOf(key);
      state.pending = Math.max(0, state.pending - 1);
      state.finished = seq;
    },
    discarded(key: string): void {
      const state = stateOf(key);
      if (state.accepted > state.finished) return;
      state.owed = Math.max(state.owed, state.finished);
    },
    accepted(key: string): void {
      const state = stateOf(key);
      state.accepted = Math.max(state.accepted, state.finished);
      if (state.owed !== 0 && state.owed < state.finished) state.owed = 0;
    },
    // 必须等待 SWR 完成接受或丢弃判定后再结算补取，不能在请求刚结束时提前清账。
    settle(key: string): boolean {
      const state = stateOf(key);
      if (state.pending > 0 || state.owed === 0) return false;
      state.owed = 0;
      return true;
    },
  };
}

export const MOUNT_REFETCH_DEDUPE_MS = 2_000;

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
