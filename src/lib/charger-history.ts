import { CHARGER_HISTORY_LIMIT } from "@/lib/limits";
import type { ChargerPayload, ChargerSample } from "@/lib/types";

/**
 * 充电头功率曲线的客户端累加器。
 *
 * 曲线是增量拉的：每次只问服务端要 `?since=` 之后的新点，本地拼成完整序列。
 * 这份状态从组件的 ref 提到模块级，是为了让实时推送也能用同一套合并逻辑 ——
 * 从前推送只能发一个失效通知、让卡片自己重新拉一次，就是因为转发那段在模块
 * 单例里，够不着组件内部的 ref。整个页面只有一张充电头卡，单例不会串。
 */

let history: ChargerSample[] = [];

/** 已有序列里最新一点的时刻，作为下次增量拉取的游标；空序列返回 null 表示要整份 */
export function historyCursor(): number | null {
  return history.length ? history[history.length - 1].t : null;
}

/**
 * 把一份响应并进本地序列，返回带完整曲线的那份。
 *
 * `historyPartial` 为假就是整份快照（首次请求，或落后太多、服务端已经把中间
 * 那段裁掉了），直接替换；为真才是增量，接在后面。
 */
export function mergeChargerHistory(payload: ChargerPayload): ChargerPayload {
  const merged = payload.historyPartial ? [...history, ...payload.history] : payload.history;
  history = merged.slice(-CHARGER_HISTORY_LIMIT);
  return { ...payload, history };
}
