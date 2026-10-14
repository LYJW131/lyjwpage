import { CRON_HEARTBEAT_EVERY_MINUTES, CRON_HEARTBEAT_OFFSET_MINUTES } from "@shared/health";

// 每轮落在评分窗口收口加上评分余量之后，刚收口的窗口当轮就能评。
export const CRON_SCHEDULE = `${Array.from(
  { length: 60 / CRON_HEARTBEAT_EVERY_MINUTES },
  (_, index) => index * CRON_HEARTBEAT_EVERY_MINUTES + CRON_HEARTBEAT_OFFSET_MINUTES,
).join(",")} * * * *`;

// scheduledTime 是驱动方那一分钟的触发时刻；60 能被周期整除，按纪元分钟取模与按钟面分钟取模等价。
export function cronRoundDue(scheduledTime: number): boolean {
  return Math.floor(scheduledTime / 60_000) % CRON_HEARTBEAT_EVERY_MINUTES === CRON_HEARTBEAT_OFFSET_MINUTES;
}
