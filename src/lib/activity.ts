import { localDate } from "@/lib/freshness";
import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ActivityPayload, ActivityStatus } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

/**
 * 在取数出口盖一次「手表那边现在还是不是这一天」。
 *
 * 过期是时间的函数，取数时现算，卡片直接用 —— 这是个例外：实时卡的在线判断都只盖
 * 时间戳、由浏览器按自己的钟算，而跨日要一个会走的钟，浏览器没有（理由见
 * ActivityPayload 的 currentAtSource）。跨过午夜之后手表上的圈已经归零，站点手上
 * 这份满环说的是昨天 —— 那是这条数据唯一会「光靠时间流逝就变错」的地方，所以也是
 * 唯一要现算的东西。
 */
export function withActivityFreshness(
  payload: ActivityPayload,
  now = Date.now(),
): ActivityPayload {
  return {
    ...payload,
    currentAtSource: localDate(now, payload.secondsFromGMT) === payload.date,
  };
}

/**
 * 圆环读数在可滞后层（KV `activity:v1`），由 iPhone 上报入口写。`pushedAt` 就是那条
 * 记录的 `updatedAt`（最后一次带来圆环的那封上报的收到时刻），不另存一份。
 */
export async function getActivitySnapshot(): Promise<LagResult<ActivityPayload>> {
  // 还没收到过任何上报：交给 statusEnvelope 变成降级信封，卡片自己不写提示
  const stored = await loadLag<ActivityStatus>(LAG_KEYS.activity, "尚未收到活动圆环上报");
  return stored.map((activity) => withActivityFreshness({ ...activity, pushedAt: stored.updatedAt, currentAtSource: true }));
}
