export type RoundLoop<P> = {
  collect: () => Promise<P | null>;
  push: (payload: P) => Promise<void>;
  waitForNextRound: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  onPushFailure: (error: unknown) => void;
  now: () => number;
  reuseMs: number;
  retryMs: number;
  maxRetryMs: number;
};

// 上报失败只重发同一份采集结果（reporter 块每次照常重建）：重新采集会在每个退避步里
// 再打一遍各家限额接口，Anthropic 的 /api/oauth/usage 几次就回 429。超过 reuseMs 才重采。
// 重发成功后立即重采一次再进入正常等待，否则下一次采集会比间隔晚将近一个 reuseMs。
export async function runRounds<P>(loop: RoundLoop<P>): Promise<never> {
  let pending: { payload: P; at: number } | null = null;
  let backoff = loop.retryMs;
  let retried = false;
  for (;;) {
    try {
      if (!pending || loop.now() - pending.at > loop.reuseMs) {
        pending = null;
        const at = loop.now();
        const payload = await loop.collect();
        if (payload !== null) pending = { payload, at };
      }
      if (pending) {
        await loop.push(pending.payload);
        pending = null;
      }
      backoff = loop.retryMs;
      if (retried) {
        retried = false;
        continue;
      }
      await loop.waitForNextRound();
    } catch (error) {
      retried = true;
      loop.onPushFailure(error);
      await loop.sleep(backoff);
      backoff = Math.min(backoff * 2, loop.maxRetryMs);
    }
  }
}
