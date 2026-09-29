import { key } from "@/lib/storage";
import type { StateLane } from "@shared/pulse-timeline";

/**
 * Pulse 事实时间线的键；`v2` 是存储形状的版本段。形状与写入规则见 shared/pulse-timeline。
 */
/** 一条状态道已经关上的区间，追加写 */
export const pulseLaneKey = (lane: StateLane) => key("pulse", "v2", lane);
/** 一条状态道还开着的那一段，单值 */
export const pulseLaneOpenKey = (lane: StateLane) => key("pulse", "v2", lane, "open");
/** 「最近在听」列表变动留下的不确定区间 `(since, t]` */
export const pulseListeningTracesKey = () => key("pulse", "v2", "listening-traces");
export const pulseChargingKey = () => key("pulse", "v2", "charging");
export const pulseActivityKey = () => key("pulse", "v2", "activity");
/** 最近一次权威替换的范围 `{from, to}`，归档据此在 D1 里做同一次替换 */
export const pulseActivityRangeKey = () => key("pulse", "v2", "activity", "range");
/** 范围内的桶真变了才 +1；归档用它挡住较旧的异步替换 */
export const pulseActivityRevisionKey = () => key("pulse", "v2", "activity", "revision");
/** iPhone 最近几次训练的时间与项目名，Pulse 自己留一份 */
export const pulseWorkoutsKey = () => key("pulse", "v2", "workouts");
