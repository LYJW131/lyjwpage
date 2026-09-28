import type { WorkoutsPayload } from "@/lib/types";
import { writePulseWorkouts } from "@api/stores/pulse";

/**
 * 状态核心这一半只留 Pulse 活动道要的训练区间（时间与项目名）。训练列表本身是展示
 * 快照，由上报入口整份写进可滞后层（见 workers/ingress 的 lag-ingest），HealthKit 里删掉
 * 的训练随整份替换一起消失。
 */
export async function writeWorkouts(value: WorkoutsPayload): Promise<void> {
  await writePulseWorkouts(value.items.map(({ startedAt, endedAt, activityType }) => ({ startedAt, endedAt, activityType })));
}
