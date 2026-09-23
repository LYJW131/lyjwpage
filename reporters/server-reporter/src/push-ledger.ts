/**
 * 这个上报器自己的推送账本：过去 12 小时推成功了几封，连同镜像的提交放进每一封的
 * `reporter` 块。站点卡片服务区据此显示 Push 次数和线上跑的是哪一版。
 *
 * 只数成功的：站点回了 ok 才记一笔，推失败的那轮不算。这一封自己算进去（+1）——
 * 它要是失败了，下一封的数自然就对了。十分钟一格，落在挂进来的卷上，容器重建、
 * 机器重启接着数；写不进也不挡上报，只是重启后从零数。
 *
 * server-reporter 和 agents-reporter 各抄这一份（和 log.ts 一样），改一边同步另一边。
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 和站点卡片里 Vercel / Workers 那几格同一个 12 小时 */
export const WINDOW_MS = 12 * 3_600_000;
export const BUCKET_MS = 10 * 60_000;

/** [这一格的起点, 这一格推成功几封] */
export type Buckets = [number, number][];

/** 报文里的 `reporter` 块 */
export type ReporterBlock = {
  commit: string | null;
  pushes: number;
  /** 窗口起止，epoch 毫秒。账本刚开始记时起点晚于 12 小时前 */
  start: number;
  end: number;
};

/** 记一笔：落进这一格、丢掉窗口外的格子。纯函数 */
export function recordPush(buckets: Buckets, at: number): Buckets {
  const bucket = Math.floor(at / BUCKET_MS) * BUCKET_MS;
  const kept = buckets
    .filter(([start]) => start + BUCKET_MS > at - WINDOW_MS)
    .map(([start, count]): [number, number] => [start, count]);
  const last = kept.at(-1);
  if (last && last[0] === bucket) last[1] += 1;
  else kept.push([bucket, 1]);
  return kept;
}

/** 窗口内推成功的次数和实际起点。纯函数 */
export function countPushes(buckets: Buckets, now: number): { pushes: number; start: number } {
  const since = now - WINDOW_MS;
  const kept = buckets.filter(([start]) => start + BUCKET_MS > since);
  const first = kept[0];
  return {
    pushes: kept.reduce((sum, [, count]) => sum + count, 0),
    start: first ? Math.max(since, first[0]) : Math.floor(now / BUCKET_MS) * BUCKET_MS,
  };
}

function isBuckets(value: unknown): value is Buckets {
  return Array.isArray(value) && value.every(
    (row) => Array.isArray(row) && row.length === 2 && row.every((n) => Number.isSafeInteger(n) && n >= 0),
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
      if (isBuckets(parsed)) buckets = parsed;
    } catch (error) {
      // 第一次跑还没有这个文件，不算错
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") onError(error);
    }
  }

  return {
    /** 这一封要带的 `reporter` 块，次数里含这一封自己 */
    async block(now = Date.now()): Promise<ReporterBlock> {
      await load();
      const { pushes, start } = countPushes(buckets, now);
      return { commit, pushes: pushes + 1, start, end: now };
    },
    /** 站点收下了再记账；落盘失败只记日志 */
    async succeeded(at = Date.now()): Promise<void> {
      await load();
      buckets = recordPush(buckets, at);
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
