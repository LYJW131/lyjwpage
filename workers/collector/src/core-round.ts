import type { StateCoreRpc } from "@shared/state-core";

import { explain } from "./job";

// 失败只记 warn：core 的心跳已把这一轮记成失败或漏跑，不该拖垮同一分钟的采集任务。
export async function driveCoreRound(core: Pick<StateCoreRpc, "cronRound">, scheduledTime: number): Promise<void> {
  try {
    await core.cronRound(scheduledTime);
  } catch (error) {
    console.warn("[core-round]", explain(error));
  }
}

