import type { CodingUsagePayload } from "@/lib/types";

import type { CodingUsageAgent, CodingUsageDay } from "./coding-usage";
import type { CodingUsageSource } from "./coding-usage-sources";

/**
 * coding 用量视图：状态核心在同一次提交里由各来源的账本算出，存一份，读出口原样给。
 *
 * **全历史的聚合写时算，和钟有关的切片读时算**：合计、排名、各 agent 最近一个有行的日子、
 * 每天的模型拆分在这里；「那一天是不是今天」（浏览器）和年度窗口从哪天起（读出口按站点今天切）
 * 不在这里。只有日行真的变了才重算。
 */

/**
 * `coding:usage:<来源>` 的一格（字段 = agent id）：这个来源最后一次报来的这个 agent 的账本。
 * `state: "error"` 那一轮只换状态，日子沿用上一份（从没成功过就是空数组）。
 */
export type StoredCodingUsageAgent = Omit<CodingUsageAgent, "days"> & {
  days: CodingUsageDay[];
  /** 状态核心收到这份账本的时刻 */
  receivedAt: number;
};

/** 全部来源的账本：来源 → agent id → 账本 */
export type StoredCodingUsage = Partial<Record<CodingUsageSource, Record<string, StoredCodingUsageAgent>>>;

/**
 * `coding:usage:year`：最近 `CODING_YEAR_KEEP_DAYS` 个站点日每天的合计与精确的模型前五。
 * 读出口按站点今天切出 53 周、编码成 `CodingYearPayload` 的 `days/models/mix`。
 */
export type CodingUsageYearView = {
  updatedAt: number;
  /** 站点日 → 那一天的合计与前五模型（`[模型, tokens]`，按 tokens 降序）；没有行的日子不出现 */
  days: Record<string, { tokens: number; models: Array<[model: string, tokens: number]> }>;
};

/** 一次重算的产物：公开视图（`coding:usage:view`）与年度视图（`coding:usage:year`） */
export type CodingUsageViews = { view: CodingUsagePayload; year: CodingUsageYearView };

/** 全部历史的前几名模型 */
export const CODING_TOP_MODELS = 3;
/** 每个 agent 自己的模型名单最多留几个 */
export const CODING_AGENT_MODELS = 20;
/** 年度视图留几天：53 周是 371 天，多留几天给站点今天往前挪的余量 */
export const CODING_YEAR_KEEP_DAYS = 380;
/** 年度格子每天留前几名模型 */
export const CODING_YEAR_TOP_MODELS = 5;
