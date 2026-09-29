/**
 * 卡片崩溃之后的恢复节奏、上报去重与重试前的缓存准备（components/card-boundary 用）。纯逻辑，好测。
 *
 * 错误边界一旦兜住，整棵子树就卸载了：这张卡的数据 hook 不再轮询，也不会自己回来。
 * 所以恢复要有人主动做（点 Retry），也要有一点自动的 —— 服务端一次性的坏响应、
 * 部署那几分钟的错位，过一会儿就好了，不该让访客自己发现并去刷新整页。
 */

/**
 * 崩溃之后自动重试的间隔序列，用完就不再自动试，交给人（Retry / Reload）。
 * 逐步放长是因为一直崩的多半是真有 bug，不该一直空转、一直报错。
 */
export const RECOVERY_DELAYS_MS = [20_000, 60_000, 180_000] as const;

/** 同一张卡这么久没有再崩过，就当上一轮结束了，重试次数和上报去重都从头算 */
export const RECOVERY_FORGET_MS = 10 * 60_000;

export type FaultRecord = {
  /** 这次崩溃要不要报 Sentry：同一张卡、同样的错，在一轮里只报一次 */
  report: boolean;
  /** 这次崩溃之后多久自动重试；null 是自动重试用完了 */
  retryInMs: number | null;
  /** 这一轮里已经自动重试了几次（这次崩溃之前） */
  attempt: number;
};

/** 用来判「同样的错」：取错误信息，不带调用栈；抛的不一定是 Error 实例 */
export function describeFault(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.slice(0, 200);
}

export function createFaultLedger() {
  const rows = new Map<string, { attempts: number; at: number; messages: Set<string> }>();
  return {
    /** 一次崩溃：记账，返回该不该上报、多久之后自动重试 */
    record(label: string, message: string, now: number): FaultRecord {
      let row = rows.get(label);
      if (!row || now - row.at > RECOVERY_FORGET_MS) {
        row = { attempts: 0, at: now, messages: new Set() };
        rows.set(label, row);
      }
      row.at = now;
      const attempt = row.attempts;
      const retryInMs = RECOVERY_DELAYS_MS[attempt] ?? null;
      // 排上了一次自动重试就算一次；重试若又崩，下一次崩溃拿到的是下一档间隔
      if (retryInMs !== null) row.attempts += 1;
      const report = !row.messages.has(message);
      row.messages.add(message);
      return { report, retryInMs, attempt };
    },
  };
}

/** 取不到就别干等：超过这么久按取失败处理，Retry 不能一直转圈 */
export const PRIME_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export type PrimeCardCacheIo<E extends { ok: boolean }> = {
  /** 能用状态信封读的键。别的键（版本接口）没有首屏那份，清掉缓存就够了 */
  isStatusPath: (path: string) => boolean;
  /** 读一份此刻的信封；网络错误、非 2xx 抛出 */
  read: (path: string) => Promise<E>;
  /** 写进 SWR 缓存；`undefined` 是清掉这个键 */
  write: (path: string, value: E | undefined) => unknown;
  /**
   * 这个键上「有新值落进缓存」的代次（lib/status-reads 的 `writeGeneration`：推送和轮询的响应都会推进它）。
   * 每个键发起取数时记一次，写之前再比：变了就是别人先写了更新的值，这次的结果（清缓存也一样）不落地。
   */
  generation: (path: string) => number;
  /** 发起这趟重试的卡片已经卸载：什么都不写 */
  cancelled: () => boolean;
  timeoutMs?: number;
};

/**
 * 重试前给这张卡读的每个键备好缓存：状态端点主动取一份此刻的有效信封写进去，
 * 重新挂载读到的就是它。
 *
 * 只清缓存救不回所有情况：让卡崩的若是首屏那份（SWR 的 fallbackData），缓存一清，重新挂载
 * 又从它起步，渲染时再抛一次，连挂载时的回源都跑不到。取不到（网络、超时、上游降级信封）
 * 就退回清掉这个键，和只清缓存一样。各个键并行，最长等 `timeoutMs`。
 *
 * 取数是异步的，途中同一个键可能被推送、或别的卡的轮询写进更新的值（很多键没有时间戳可比，
 * 只能按代次判）；卡片也可能已经卸载。这两种情况都不写，包括退回的清缓存：慢回来的这份
 * 不能盖掉更新的值，也不能替一张已经不在的卡改缓存。
 */
export async function primeCardCache<E extends { ok: boolean }>(paths: readonly string[], io: PrimeCardCacheIo<E>): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      const issuedAt = io.generation(path);
      let fresh: E | undefined;
      if (io.isStatusPath(path)) {
        try {
          const envelope = await withTimeout(io.read(path), io.timeoutMs ?? PRIME_TIMEOUT_MS);
          if (envelope.ok) fresh = envelope;
        } catch {
          // 取不到：退回清缓存
        }
      }
      if (io.cancelled() || io.generation(path) !== issuedAt) return;
      await io.write(path, fresh);
    }),
  );
}
