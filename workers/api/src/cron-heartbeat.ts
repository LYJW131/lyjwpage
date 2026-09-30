import { CRON_HEARTBEAT_EVERY_MINUTES, SENTRY_CRON_MONITOR_SLUG } from "@/lib/sentry";

export const CRON_MONITOR_SLUG = SENTRY_CRON_MONITOR_SLUG;
export const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: `*/${CRON_HEARTBEAT_EVERY_MINUTES} * * * *` },
  checkinMargin: 2,
  maxRuntime: 5,
  timezone: "UTC",
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;

export function heartbeatDue(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCMinutes() % CRON_HEARTBEAT_EVERY_MINUTES === 0;
}
