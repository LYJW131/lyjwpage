import * as Sentry from "@sentry/cloudflare";
import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./env";

/**
 * 采集 Worker 的 Sentry 配置（项目 `collector-worker`）：cron、`Collector` RPC 共用。
 *
 * DSN 只配在 wrangler.toml 的 `[vars]`：本地 wrangler.test.toml 不配，本地就不上报。
 * release 由 SDK 从 `CF_VERSION_METADATA` 取版本 ID。日志只收 warn / error ——
 * 缺令牌跳过、上游不可用这类提示原样进 Sentry Logs。
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
  };
}

/** 同一个任务在一个 isolate 里多久最多开一次 issue：分钟级任务连着失败时不刷屏 */
const REPORT_EVERY_MS = 15 * 60_000;
const reportedAt = new Map<string, number>();

/**
 * 任务真失败时开 Sentry issue，按任务分组（fingerprint `collector-job` + 任务名）。
 *
 * 每个任务本来有一条 cron 监控（`collector-<任务>`），但组织的监控名额只有一个，已经给了
 * `api-minute-cron`（见 docs/ops-facts.md），多出来的监控建出来就是停用状态。issue 不占名额：失败照样看得见、能配告警。
 * 监控那边的报到照常发，名额加上之后在 Sentry 里启用即可，不用改代码。
 */
export function reportJobFailure(job: string, error: Error): void {
  const now = Date.now();
  if (now - (reportedAt.get(job) ?? 0) < REPORT_EVERY_MS) return;
  reportedAt.set(job, now);
  Sentry.withScope((scope) => {
    scope.setTag("collector.job", job);
    scope.setFingerprint(["collector-job", job]);
    Sentry.captureException(error);
  });
}
