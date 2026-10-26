import type { StateCoreRpc } from "@shared/state-core";

import { explain } from "./job";
import { isLateRound } from "./registry";

// 失败只记 warn：core 的心跳已把这一轮记成失败或漏跑，不该拖垮同一分钟的采集任务。
export async function driveCoreRound(core: Pick<StateCoreRpc, "cronRound">, scheduledTime: number): Promise<void> {
  try {
    await core.cronRound(scheduledTime);
  } catch (error) {
    console.warn("[core-round]", explain(error));
  }
}

// 迟到的一轮采集任务整轮跳过，core 那一轮仍按收到的时刻跑：Cloudflare 晚投时这常是 core 那一格唯一一次投递，跳过就记成心跳失败。
export function coreRoundTime(scheduledTime: number, now: number): number {
  return isLateRound(scheduledTime, now) ? now : scheduledTime;
}
