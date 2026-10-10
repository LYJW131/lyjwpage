import { localDate } from "@/lib/freshness";
import { loadLag, type LagResult } from "@/lib/lag-result";
import type { ActivityPayload, ActivityStatus } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

// 跨日失效必须在取数时计算；缓存中的昨天满环不能继续代表今天。
export function withActivityFreshness(
  payload: ActivityPayload,
  now = Date.now(),
): ActivityPayload {
  return {
    ...payload,
    currentAtSource: localDate(now, payload.secondsFromGMT) === payload.date,
  };
}

export async function getActivitySnapshot(): Promise<LagResult<ActivityPayload>> {
  const stored = await loadLag<ActivityStatus>(LAG_KEYS.activity, "No activity ring report yet");
  return stored.map((activity) => withActivityFreshness({ ...activity, pushedAt: stored.updatedAt, currentAtSource: true }));
}
