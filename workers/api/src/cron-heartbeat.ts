import { SENTRY_CRON_MONITOR_SLUG } from "@/lib/sentry";

/**
 * 分钟 cron 的心跳（免费档只有一个监控位，给它）。cron 每分钟跑，心跳只每 5 分钟报一次：
 * 每次报到是开始、结束两个请求，每分钟都报太费。连续两次（约 10 分钟）没按时报到或报错才开
 * issue，单次 Apple / PageSpeed 抖动不吵人。slug 就是 Sentry 里那条监控的名字；schedule 随
 * 每次报到同步到 Sentry，改这里就改了那边。站点卡片 API 那一行按它的报到记录画。
 */
export const CRON_MONITOR_SLUG = SENTRY_CRON_MONITOR_SLUG;
export const CRON_HEARTBEAT_EVERY_MINUTES = 5;
export const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: `*/${CRON_HEARTBEAT_EVERY_MINUTES} * * * *` },
  checkinMargin: 2,
  maxRuntime: 5,
  timezone: "UTC",
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;

/** 这一轮 cron 要不要给 Sentry 报心跳：按触发时刻的 UTC 分钟，和上面的 crontab 对齐 */
export function heartbeatDue(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % CRON_HEARTBEAT_EVERY_MINUTES === 0;
}
