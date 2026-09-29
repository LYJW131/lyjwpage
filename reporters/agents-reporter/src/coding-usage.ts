/**
 * 这个上报器发给站点的 coding 用量事实：日行账本、最近活动、5 分钟 token 桶。
 *
 * 类型同构于站点的 `shared/coding-usage.ts`（语义、校验规则都以那边为准）。上报器是独立部署单元，
 * 镜像里只有这个目录，不能 import 站点的 shared，所以抄一份；`coding-contract.test.mts` 把这里各处
 * 产出的载荷喂给站点真正的 `normalizeCoding*Report`，抄歪了、或者校验规则变了，那条测试会红。
 *
 * 时刻一律 epoch 毫秒，日期一律 `YYYY-MM-DD`（Asia/Shanghai 站点日）。
 */

/** 桶长；桶起点是它的整数倍 */
export const CODING_BUCKET_MS = 300_000;

/**
 * 站点对一个日行的模型行数、一个桶窗口的行数各有上限，超了那个模块整份被拒收。
 * 源：shared/coding-usage.ts#MAX_DAY_MODELS、shared/coding-usage.ts#MAX_WINDOW_ROWS
 * （`coding-contract.test.mts` 用站点真正的校验核对：收得下这么多，多一行就拒）
 */
export const MAX_DAY_MODELS = 64;
export const MAX_WINDOW_ROWS = 64;

/**
 * 超出上限的模型行并成的那一行的名字。取站点隐藏名单里的占位名：视图不当模型名展示、不进排名，
 * 合计照算。源：shared/coding-models.ts#HIDDEN_CODING_MODELS（同一份契约测试核对它确实被隐藏）
 */
export const OVERFLOW_MODEL = "unknown";

export function bucketStart(ms: number): number {
  return Math.floor(ms / CODING_BUCKET_MS) * CODING_BUCKET_MS;
}

export type CodingUsageDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** outputTokens 的子集；来源不分就是 0 */
  reasoningTokens: number;
  /** ≥ 前四列之和 */
  totalTokens: number;
  apiEquivalentCostUSD: number;
  /** 这一天所有有 token 的请求都估到了价 */
  costComplete: boolean;
  models: Array<{ model: string; tokens: number }>;
};

/** state = ok 必带 days；state = error 必须缺省：只换状态，站点不动历史 */
export type CodingUsageAgent = {
  id: string;
  state: "ok" | "error";
  /** 最近一次成功采集；从没成功过为 null。state = ok 时必有 */
  collectedAt: number | null;
  error: string | null;
  warning: string | null;
  /** 没有会话概念（Cursor）为 null */
  sessionCount: number | null;
  days?: CodingUsageDay[];
};

export type CodingUsageReport = { agents: CodingUsageAgent[] };

export type CodingActivityReport = {
  collectedAt: number;
  /** lastActivityAt 为 null = 这一轮没见过它的用量事件 */
  agents: Array<{ id: string; lastActivityAt: number | null; model: string | null }>;
};

export type CodingTokenBucketState = "ok" | "partial" | "unavailable";

export type CodingTokenBucketRow = {
  id: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  /** 去重后的用量事件数 */
  eventCount: number | null;
};

export type CodingTokenBucketWindow = { from: number; agents: CodingTokenBucketRow[] };

/** [from, to) 范围内以这封为准（缺席的桶 = 0），范围外站点不动 */
export type CodingTokenBucketReport = {
  from: number;
  to: number;
  collectedAt: number;
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  windows: CodingTokenBucketWindow[];
};
