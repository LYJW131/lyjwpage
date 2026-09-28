import { loadLag, type LagResult } from "@/lib/lag-result";
import type { Workout, WorkoutsPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";

/**
 * 最近十次训练在可滞后层（KV `workouts:v1`），由 iPhone 上报入口整份写。`pushedAt`
 * 就是那条记录的 `updatedAt`（最后一次带来训练列表的那封上报的收到时刻）。
 */
export async function getWorkoutsSnapshot(): Promise<LagResult<WorkoutsPayload>> {
  const stored = await loadLag<{ items: Workout[] }>(LAG_KEYS.workouts, "Awaiting workout report");
  return stored.map(({ items }) => ({ items, pushedAt: stored.updatedAt }));
}
