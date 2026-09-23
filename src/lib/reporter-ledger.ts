/**
 * 常驻上报器的账本：Worker 每收到一封就在这里记一笔，站点卡片服务区据此显示
 * 「过去 12 小时推了几次」和「线上跑的是哪个提交」。
 *
 * 次数在收件这一侧数，不让上报器自己数：两个上报器一个 Python 一个 Node，各数各的
 * 口径不齐；而且只有 Worker 知道哪一封真的到了，上报器那边推送失败的一轮不该算。
 * 这份文件只放纯计算，浏览器和 Worker 都能引；存取在 shared/reporters 与
 * workers/api/src/stores/reporter-ledger。
 */

/** 上报来源 → 卡片上认的上报器名字。只数常驻在 misaka-jp 上的这两个 */
export const REPORTER_BY_SOURCE = {
  server: "server-reporter",
  agents: "agents-reporter",
} as const;

export type ReporterName = (typeof REPORTER_BY_SOURCE)[keyof typeof REPORTER_BY_SOURCE];

/** 和 Vercel / Workers 那几格同一个 12 小时 */
export const LEDGER_WINDOW_MS = 12 * 3_600_000;
/** 十分钟一格，12 小时七十来格，一行 JSON 几 KB */
export const LEDGER_BUCKET_MS = 10 * 60_000;

export type StoredLedger = {
  /** [这一格的起点, 这一格收到几封] */
  buckets: [number, number][];
  /** 最近一封带来的提交；上报器没带（本地跑、旧镜像）是 null */
  commit: string | null;
  lastPushAt: number;
};

export type ReporterStat = {
  commit: string | null;
  pushes: number;
  /** 窗口起止，epoch 毫秒。账本刚开始记时起点晚于 12 小时前 */
  start: number;
  end: number;
  lastPushAt: number;
};

export type ReportersPayload = {
  reporters: Record<ReporterName, ReporterStat | null>;
};

/** 报文里的 reporterCommit：认 7–40 位小写十六进制，别的一律当没带，不因此拒掉整封 */
export function reporterCommitOf(raw: unknown): string | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>).reporterCommit : null;
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value) ? value : null;
}

/** 记一笔：落进这一格、丢掉窗口外的格子 */
export function recordPush(previous: StoredLedger | null, at: number, commit: string | null): StoredLedger {
  const bucket = Math.floor(at / LEDGER_BUCKET_MS) * LEDGER_BUCKET_MS;
  const buckets = (previous?.buckets ?? []).filter(([start]) => start + LEDGER_BUCKET_MS > at - LEDGER_WINDOW_MS);
  const last = buckets.at(-1);
  if (last && last[0] === bucket) last[1] += 1;
  else buckets.push([bucket, 1]);
  return { buckets, commit, lastPushAt: at };
}

/** 读的时候再按此刻裁一次窗口：上报器停了几小时，旧格子要自己滑出去 */
export function summarizeLedger(ledger: StoredLedger | null, now: number): ReporterStat | null {
  if (!ledger) return null;
  const since = now - LEDGER_WINDOW_MS;
  const kept = ledger.buckets.filter(([start]) => start + LEDGER_BUCKET_MS > since);
  return {
    commit: ledger.commit,
    pushes: kept.reduce((sum, [, count]) => sum + count, 0),
    start: kept.length ? Math.max(since, kept[0][0]) : since,
    end: now,
    lastPushAt: ledger.lastPushAt,
  };
}
