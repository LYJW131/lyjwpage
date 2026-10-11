import { activityCurrentAt } from "@/lib/freshness";
import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ActivityPayload, ActivityStatus } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

// 取数出口按源站钟现算 currentAtSource。首屏会冻住这个布尔，页面用 activityDisplayedCurrent 重算。
export function withActivityFreshness(
  payload: ActivityPayload,
  now = Date.now(),
): ActivityPayload {
  return {
    ...payload,
    currentAtSource: activityCurrentAt(payload.date, payload.secondsFromGMT, now),
  };
}

export async function getActivitySnapshot(): Promise<LagResult<ActivityPayload>> {
  const stored = await loadLag<ActivityStatus>(LAG_KEYS.activity, "尚未收到活动圆环上报");
  return stored.map((activity) => withActivityFreshness({ ...activity, pushedAt: stored.updatedAt, currentAtSource: true }));
}
