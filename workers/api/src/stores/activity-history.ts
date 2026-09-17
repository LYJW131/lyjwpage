import {
  activityHistoryKey,
  planActivitySample,
  parseActivitySample,
} from "@/lib/activity-history";
import { ACTIVITY_HISTORY_LIMIT, ACTIVITY_HISTORY_TTL_MS } from "@/lib/limits";
import { askStorage, tellStorage } from "@/lib/storage";
import type { ActivityDomain, ActivityLevel } from "@/lib/types";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 往一个域的活动历史上追加一笔。历史是次要的：失败只打日志，不能让主状态上报 500。
 *
 * 读最后一条 → 规划 → 有样本才在同一批里 append + trim + expire。
 */
export async function recordActivity(
  domain: ActivityDomain,
  next: { t: number; level: ActivityLevel; hint?: string | null },
): Promise<void> {
  try {
    const k = activityHistoryKey(domain);
    const answered = await askStorage((storage) => storage.listRange(k, -1, -1));
    if (!answered.reachable) return;
    const last = answered.value[0] ? parseActivitySample(answered.value[0]) : null;
    const sample = planActivitySample(last, next);
    if (!sample) return;
    await tellStorage(async (storage) => {
      const pipe = storage.batch();
      pipe.append(k, JSON.stringify(sample));
      pipe.trim(k, -ACTIVITY_HISTORY_LIMIT, -1);
      pipe.expire(k, ACTIVITY_HISTORY_TTL_MS);
      return pipe.execute();
    });
  } catch (error) {
    console.error("[activity-history]", reason(error));
  }
}
