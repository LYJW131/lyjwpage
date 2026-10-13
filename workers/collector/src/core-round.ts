import type { StateCoreRpc } from "@shared/state-core";

import { explain } from "./job";

// 失败只记 warn：这一轮的报错由 core 的 cron 监控报到，不该拖垮同一分钟的采集任务。
export async function driveCoreRound(core: Pick<StateCoreRpc, "cronRound">, scheduledTime: number): Promise<void> {
  try {
    await core.cronRound(scheduledTime);
  } catch (error) {
    console.warn("[core-round]", explain(error));
  }
}
