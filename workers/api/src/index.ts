import * as Sentry from "@sentry/cloudflare";

import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import { previewWorkerEnabled } from "./preview";
import { historyArchiveEnabled, pulseScoringEnabled, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer, clefDecide } from "./pulse-score";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { CRON_MONITOR_CONFIG, CRON_MONITOR_SLUG } from "./cron-heartbeat";
import { freshnessCheckDue, watchFreshness, type FreshnessEvent } from "./freshness-watch";
import { sentryOptions } from "./sentry";

// Wrangler 迁移按导出名识别 DO；Sentry 包装不能改变这些名称。
export const LivePushRoom = Sentry.instrumentDurableObjectWithSentry(sentryOptions, LivePushRoomBase);
export const StateHub = Sentry.instrumentDurableObjectWithSentry(sentryOptions, StateHubBase);
export const StateCore = Sentry.withSentry(sentryOptions, StateCoreBase);
export const DevOverrideReader = Sentry.withSentry(sentryOptions, DevOverrideReaderBase);
export type { Env } from "./runtime";

const apiWorker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return originWorker.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Preview 仍可能连着共享归档，必须独立禁止 cron 写入。
    if (previewWorkerEnabled()) return;
    await Sentry.withMonitor(CRON_MONITOR_SLUG, () => runScheduled(env, event.scheduledTime), CRON_MONITOR_CONFIG);
  },
};

// 只有 StateHub 整个调不通才让这一轮按失败报到；子步骤失败只记 warn 和一条事件，站点的 API 在线行不跟着闪。
async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  const archiving = historyArchiveEnabled(env);
  const scoring = pulseScoringEnabled(env);
  if (!archiving && !scoring) return;
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  const [ticked] = await Promise.allSettled([
    hub.pulseTick(),
    env.LAG && freshnessCheckDue(scheduledTime) && watchFreshness({
      now: Date.now(),
      lag: env.LAG,
      hubRead: (commands) => hub.publicRead(commands),
      emit: reportFreshness,
    }).catch((error: unknown) => stepFailed("freshness-watch", error)),
  ]);
  if (ticked.status === "rejected") throw ticked.reason;
  const tick = ticked.value;
  await Promise.all([
    archiving && new PulseArchive({ coordinator: hub, db: env.HISTORY! }).run(tick.archive)
      .catch((error: unknown) => stepFailed("pulse-archive", error)),
    scoring && new PulseScorer({ coordinator: hub, decide: clefDecide(env.AI!) }).run(tick.score)
      .catch((error: unknown) => stepFailed("pulse-score", error)),
  ]);
}

function stepFailed(step: string, error: unknown): void {
  console.warn(`[${step}]`, error);
  Sentry.captureException(error, { level: "warning", tags: { "cron.step": step } });
}

function reportFreshness({ source, state, lastSeenAt, ageMs, thresholdMs }: FreshnessEvent): void {
  Sentry.captureMessage(state === "stale" ? `Feed stale: ${source}` : `Feed recovered: ${source}`, {
    level: state === "stale" ? "warning" : "info",
    tags: { "freshness.source": source, "freshness.state": state },
    extra: { lastSeenAt: new Date(lastSeenAt).toISOString(), ageMinutes: Math.round(ageMs / 60_000), thresholdMinutes: thresholdMs / 60_000 },
    fingerprint: ["freshness", source, state],
  });
}

export default Sentry.withSentry(sentryOptions, apiWorker);
