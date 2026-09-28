import type { ActivityStatus } from "@/lib/types";

/**
 * Apple Watch 的活动圆环 + 当天步数，以及 Pulse 用的五分钟统计桶。
 *
 * 喂它的是 iPhone 上那个自己写的上报器（`reporters/iphone-telemetry-hub`）：从
 * HealthKit 读 `HKActivitySummary`，一次把三环的**已完成和目标**都拿到 —— 目标只有
 * 原生 App 读得到，所以它不在站点这侧配，跟着报文走。
 *
 * 这条路上**没有实时推送**：圈以分钟为尺度涨，卡片按 5 分钟自己来问。圆环读数是
 * 展示快照，归可滞后层（KV `activity:v1`，上报入口写）；五分钟桶是 Pulse 的输入，
 * 归状态核心（见 workers/api/src/stores/activity）。
 */

export type StoredActivity = {
  activity: ActivityStatus;
  /** 源站收到的时刻 */
  receivedAt: number;
};

/** iPhone 从 HealthKit 读取的一个闭合五分钟统计桶；缺项保持 null，不补零。 */
export type ActivityHistoryBucket = {
  from: number;
  to: number;
  moveKcal: number | null;
  exerciseMinutes: number | null;
  steps: number | null;
};

/**
 * `from` / `to` 是这次查询的权威范围。范围内没出现在 buckets 的时间是未知，
 * 接收端会删掉旧桶；`to` 永远是最后一个已经结束的 UTC 五分钟边界。
 */
export type ActivityHistory = {
  from: number;
  to: number;
  buckets: ActivityHistoryBucket[];
};

export type ActivityReport = {
  current: StoredActivity | null;
  /** 旧版 iPhone 上报器升级前没有此字段；出现后按查询范围权威替换。 */
  history: ActivityHistory | null;
};

