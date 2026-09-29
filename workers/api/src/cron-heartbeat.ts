import { SENTRY_CRON_MONITOR_SLUG } from "@/lib/sentry";

/**
 * 分钟 cron 的心跳（组织的 cron 监控名额只有一个，给它，见 docs/ops-facts.md）。cron 每分钟跑，
 * 心跳只每 `CRON_HEARTBEAT_EVERY_MINUTES` 分钟报一次：每次报到是开始、结束两个请求，每分钟都报太费。
 * 连续两次没按时报到或报错才开 issue（`CRON_MONITOR_CONFIG`），偶发一次迟到、超时不吵人。
 * 这里做 pulse 的归档与评分，两件各自兜底、失败不让心跳报错；外部拉取都在采集 Worker。
 * slug 就是 Sentry 里那条监控的名字；schedule 随
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
