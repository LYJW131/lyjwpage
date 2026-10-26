import { CRON_HEARTBEAT_EVERY_MINUTES, CRON_HEARTBEAT_OFFSET_MINUTES } from "@shared/health";

export const CRON_SCHEDULE = `${Array.from(
  { length: 60 / CRON_HEARTBEAT_EVERY_MINUTES },
  (_, index) => index * CRON_HEARTBEAT_EVERY_MINUTES + CRON_HEARTBEAT_OFFSET_MINUTES,
).join(",")} * * * *`;

const PERIOD_MS = CRON_HEARTBEAT_EVERY_MINUTES * 60_000;
const OFFSET_MS = CRON_HEARTBEAT_OFFSET_MINUTES * 60_000;

// 一格从 CRON_SCHEDULE 的某一分钟开始、长一个周期；格内第一次调用跑这一格（StateHub.claimCronSlot 去重）。
// Cloudflare 会把采集 Worker 的某分钟 cron 晚投或不投，按格认领时这一分钟没来，格内后面任一分钟仍能补上。
// 60 能被周期整除，按纪元取模与按钟面分钟取模等价。
export function cronSlot(time: number): number {
  return Math.floor((time - OFFSET_MS) / PERIOD_MS) * PERIOD_MS + OFFSET_MS;
}
