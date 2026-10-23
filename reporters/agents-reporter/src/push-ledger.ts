import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const WINDOW_MS = 12 * 3_600_000;
export const BUCKET_MS = 10 * 60_000;

// 每格：[格起点, 推成功那几封的往返毫秒, 这一格里 failure() 记下的错误次数]。
export type Buckets = [number, number[], number][];

export type ReporterBlock = {
  commit: string | null;
  pushes: number;
  rttMs: number | null;
  errors: number;
  start: number;
  end: number;
};

function isCount(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 0;
}

function withBucket(buckets: Buckets, at: number, change: (row: [number, number[], number]) => void): Buckets {
  const bucket = Math.floor(at / BUCKET_MS) * BUCKET_MS;
  const kept = buckets
    .filter(([start]) => start + BUCKET_MS > at - WINDOW_MS)
    .map(([start, rtts, errors]): [number, number[], number] => [start, [...rtts], errors]);
  let last = kept.at(-1);
  if (!last || last[0] !== bucket) kept.push(last = [bucket, [], 0]);
  change(last);
  return kept;
}

export function recordPush(buckets: Buckets, at: number, rttMs: number): Buckets {
  return withBucket(buckets, at, (row) => row[1].push(Math.max(0, Math.round(rttMs))));
}

export function recordError(buckets: Buckets, at: number): Buckets {
  return withBucket(buckets, at, (row) => { row[2] += 1; });
}

export function countPushes(buckets: Buckets, now: number): { pushes: number; rttMs: number | null; errors: number; start: number } {
  const since = now - WINDOW_MS;
  const kept = buckets.filter(([start]) => start + BUCKET_MS > since);
  const rtts = kept.flatMap(([, list]) => list).sort((a, b) => a - b);
  const mid = rtts.length >> 1;
  const first = kept[0];
  return {
    pushes: rtts.length,
    errors: kept.reduce((sum, [, , errors]) => sum + errors, 0),
    rttMs: rtts.length === 0 ? null : rtts.length % 2 ? rtts[mid]! : Math.round((rtts[mid - 1]! + rtts[mid]!) / 2),
    start: first ? Math.max(since, first[0]) : Math.floor(now / BUCKET_MS) * BUCKET_MS,
  };
}

function isBuckets(value: unknown): value is Buckets {
  return Array.isArray(value) && value.every(
    (row) => Array.isArray(row) && row.length === 3 && isCount(row[0]) && Array.isArray(row[1]) && row[1].every(isCount) && isCount(row[2]),
  );
}

export function createPushLedger(path: string, commit: string | null, onError: (error: unknown) => void) {
  let buckets: Buckets = [];
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!path) return;
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (isBuckets(parsed)) buckets = [...parsed, ...buckets];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") onError(error);
    }
  }

  return {
    async block(now = Date.now()): Promise<ReporterBlock> {
      await load();
      const { pushes, rttMs, errors, start } = countPushes(buckets, now);
      return { commit, pushes: pushes + 1, rttMs, errors, start, end: now };
    },
    // 只记内存，下一次推成功时随账本一起落盘；在这里写盘失败会再触发 failure()，绕成死循环。
    failed(at = Date.now()): void {
      buckets = recordError(buckets, at);
    },
    async succeeded(at: number, rttMs: number): Promise<void> {
      await load();
      buckets = recordPush(buckets, at, rttMs);
      if (!path) return;
      try {
        await mkdir(dirname(path), { recursive: true });
        const temp = `${path}.tmp`;
        await writeFile(temp, JSON.stringify(buckets));
        await rename(temp, path);
      } catch (error) {
        onError(error);
      }
    },
  };
}
