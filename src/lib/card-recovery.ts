
export const RECOVERY_DELAYS_MS = [20_000, 60_000, 180_000] as const;

export const RECOVERY_FORGET_MS = 10 * 60_000;

export type FaultRecord = {
  report: boolean;
  retryInMs: number | null;
  attempt: number;
};

export function describeFault(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return message.slice(0, 200);
}

export function createFaultLedger() {
  const rows = new Map<string, { attempts: number; at: number; messages: Set<string> }>();
  return {
    record(label: string, message: string, now: number): FaultRecord {
      let row = rows.get(label);
      if (!row || now - row.at > RECOVERY_FORGET_MS) {
        row = { attempts: 0, at: now, messages: new Set() };
        rows.set(label, row);
      }
      row.at = now;
      const attempt = row.attempts;
      const retryInMs = RECOVERY_DELAYS_MS[attempt] ?? null;
      if (retryInMs !== null) row.attempts += 1;
      const report = !row.messages.has(message);
      row.messages.add(message);
      return { report, retryInMs, attempt };
    },
  };
}

export const PRIME_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export type PrimeCardCacheIo<E extends { ok: boolean }> = {
  isStatusPath: (path: string) => boolean;
  read: (path: string) => Promise<E>;
  write: (path: string, value: E | undefined) => unknown;
  generation: (path: string) => number;
  cacheData: (path: string) => unknown;
  cancelled: () => boolean;
  timeoutMs?: number;
};

export async function primeCardCache<E extends { ok: boolean }>(paths: readonly string[], io: PrimeCardCacheIo<E>): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      const issuedAt = io.generation(path);
      const cachedAtStart = io.cacheData(path);
      let fresh: E | undefined;
      if (io.isStatusPath(path)) {
        try {
          const envelope = await withTimeout(io.read(path), io.timeoutMs ?? PRIME_TIMEOUT_MS);
          if (envelope.ok) fresh = envelope;
        } catch {
        }
      }
      if (io.cancelled()) return;
      if (io.generation(path) !== issuedAt) {
        // guardPolled 在 SWR 真正写缓存前推进代次；给它一个事件循环机会完成或丢弃请求。
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (io.cancelled() || !Object.is(io.cacheData(path), cachedAtStart)) return;
      }
      try {
        const write = Promise.resolve(io.write(path, fresh));
        if (fresh === undefined) {
          void write.catch(() => {});
          return;
        }
        await write;
      } catch {
      }
    }),
  );
}
