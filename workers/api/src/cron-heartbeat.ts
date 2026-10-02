import { CRON_HEARTBEAT_EVERY_MINUTES, SENTRY_CRON_MONITOR_SLUG } from "@/lib/sentry";
import { PULSE_SCORE_SETTLE_MS } from "./pulse-score";

// 每轮落在评分窗口收口加上评分余量之后，刚收口的窗口当轮就能评。
const CRON_OFFSET_MINUTES = PULSE_SCORE_SETTLE_MS / 60_000;

export const CRON_SCHEDULE = `${Array.from(
  { length: 60 / CRON_HEARTBEAT_EVERY_MINUTES },
  (_, index) => index * CRON_HEARTBEAT_EVERY_MINUTES + CRON_OFFSET_MINUTES,
).join(",")} * * * *`;

export const CRON_MONITOR_SLUG = SENTRY_CRON_MONITOR_SLUG;
export const CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: CRON_SCHEDULE },
  checkinMargin: 2,
  maxRuntime: 5,
  timezone: "UTC",
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;
