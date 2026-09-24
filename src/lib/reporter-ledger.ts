/**
 * 常驻上报器的账本：每封报文顶上带一个 `reporter` 块 —— 镜像提交、过去 12 小时推成功
 * 几封（含这一封）、往返中位数、窗口起止 —— Worker 收下时存最新那份，站点卡片服务区据此
 * 显示 Push 次数、RTT 和线上跑的是哪一版。
 *
 * 次数由上报器自己数（两个上报器同一份 push-ledger.ts）：它知道哪一封被站点收下了，
 * 状态存在自己的卷上跨重启接着数。这里只校验、只存最新值，不在收件侧重算。
 * 这份文件只放纯计算，浏览器和 Worker 都能引；存取在 shared/reporters 与
 * workers/api/src/stores/reporter-ledger。
 */

/** 上报来源 → 卡片上认的上报器名字。只收常驻在 misaka-jp 上的这两个 */
export const REPORTER_BY_SOURCE = {
  server: "server-reporter",
  agents: "agents-reporter",
} as const;

export type ReporterName = (typeof REPORTER_BY_SOURCE)[keyof typeof REPORTER_BY_SOURCE];

/** 报文里的 `reporter` 块 */
export type ReporterBlock = {
  /** 镜像构建时的提交；本地直接跑时为 null */
  commit: string | null;
  /** 窗口内推成功几封，含这一封 */
  pushes: number;
  /** 窗口内推成功那些封从发出到读完回执的中位数，毫秒，不含这一封；还没有样本时为 null */
  rttMs: number | null;
  /** 窗口起止，epoch 毫秒。上报器刚开始记时起点晚于 12 小时前 */
  start: number;
  end: number;
};

/** 存下来、对外给的：最新那个块，加上收到它的时刻（判断上报器还活着没有） */
export type ReporterStat = ReporterBlock & { lastPushAt: number };

export type ReportersPayload = {
  reporters: Record<ReporterName, ReporterStat | null>;
};

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 报文里的 `reporter` 块。不合规（旧版上报器没带、字段写坏）一律当没有 ——
 * 这是附带的账本，不因为它拒掉整封上报。
 */
export function reporterBlockOf(raw: unknown): ReporterBlock | null {
  const block = raw && typeof raw === "object" ? (raw as Record<string, unknown>).reporter : null;
  if (!block || typeof block !== "object") return null;
  const { commit, pushes, rttMs, start, end } = block as Record<string, unknown>;
  if (commit !== null && !(typeof commit === "string" && /^[0-9a-f]{7,40}$/.test(commit))) return null;
  if (rttMs !== null && !nonNegativeInteger(rttMs)) return null;
  if (!nonNegativeInteger(pushes) || !nonNegativeInteger(start) || !nonNegativeInteger(end) || end < start) return null;
  return { commit, pushes, rttMs, start, end };
}
