/**
 * 可滞后层：KV 命名空间 `lyjwpage-lag`（binding `LAG`）的键与值格式。
 *
 * 判断标准只有一条：不需要「变了立刻推、读到必是最新」、也不参与 pulse 计算的
 * 数据归这一层。写入方（上报入口、采集 Worker）直接写 KV、不推送；状态核心的
 * 公开读取端点只读、不写。每条都带 `updatedAt`（写入方最后一次成功取到它的时刻），
 * 过没过时由浏览器按该卡的阈值判断，服务端不下结论。
 *
 * KV 里的值本身就是上次成功值：取数失败时不写，旧值原样留着，不需要另存 last-good。
 * 值的形状变了就换键名后缀（`:v2`），旧键自然作废，不做兼容读取。
 */

export type LagEntry<T> = {
  /** 写入方最后一次成功取到这份数据的时刻，epoch 毫秒 */
  updatedAt: number;
  data: T;
};

/** 全部键集中登记在这里，写入方与读取方按名字取 */
export const LAG_KEYS = {
  /** 厂商状态页（采集 Worker 每分钟） */
  agentStatus: "agent-status:v1",
  /** GitHub 贡献日历（采集 Worker） */
  githubChart: "github-chart:v1",
  /** 本仓库统计（采集 Worker） */
  githubRepo: "github-repo:v1",
  /** Vercel 生产版本与最近部署（采集 Worker） */
  vercelDeployments: "vercel-deployments:v1",
  /** Vercel 函数与访问统计，按组各带采集时刻（采集 Worker） */
  vercelMetrics: "vercel-metrics:v1",
  /** PageSpeed 实验室分的滚动中位数（采集 Worker） */
  pagespeed: "pagespeed:v1",
  /** 各 Worker 当前部署的版本与提交（采集 Worker） */
  cloudflareDeployments: "cloudflare-deployments:v1",
  /** 各 Worker 12 小时调用统计（采集 Worker） */
  cloudflareMetrics: "cloudflare-metrics:v1",
  /** Sentry 在线状态、报错数、真实访客指标（采集 Worker） */
  sentry: "sentry:v1",
  /** 落地节点的最新读数（上报入口，每封 server 上报） */
  server: "server:v1",
  /** 各 agent 账号的套餐与限额窗口，按 id 合并（上报入口，agents 上报） */
  limits: "limits:v1",
  /** Mac 此刻所在时区（上报入口，mac 上报的 timezone 模块） */
  timezone: "timezone:v1",
  /** 常驻上报器的推送账本，一个上报器一条，互不覆盖（上报入口） */
  reporterServer: "reporter:server-reporter:v1",
  reporterAgents: "reporter:agents-reporter:v1",
} as const;

export type LagKey = (typeof LAG_KEYS)[keyof typeof LAG_KEYS];

/** KV 的最小子集；测试用内存替身 */
export interface LagStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function isLagEntry(value: unknown): value is LagEntry<unknown> {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) && "data" in row;
}

/** 读不到、读坏了都当没有：可滞后层允许空着，卡片自己显示 unavailable */
export async function readLag<T>(kv: LagStore, key: LagKey): Promise<LagEntry<T> | null> {
  const raw = await kv.get(key, "text");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLagEntry(parsed) ? (parsed as LagEntry<T>) : null;
  } catch {
    return null;
  }
}

export async function writeLag<T>(kv: LagStore, key: LagKey, data: T, updatedAt = Date.now()): Promise<void> {
  const entry: LagEntry<T> = { updatedAt, data };
  await kv.put(key, JSON.stringify(entry));
}
