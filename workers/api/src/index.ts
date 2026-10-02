import * as Sentry from "@sentry/cloudflare";

import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import { previewWorkerEnabled } from "./preview";
import { historyArchiveEnabled, pulseScoringEnabled, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer } from "./pulse-score";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { CRON_MONITOR_CONFIG, CRON_MONITOR_SLUG } from "./cron-heartbeat";
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
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Preview 仍可能连着共享归档，必须独立禁止 cron 写入。
    if (previewWorkerEnabled()) return;
    await Sentry.withMonitor(CRON_MONITOR_SLUG, () => runScheduled(env), CRON_MONITOR_CONFIG);
  },
};

async function runScheduled(env: Env): Promise<void> {
  const archiving = historyArchiveEnabled(env);
  const scoring = pulseScoringEnabled(env);
  if (!archiving && !scoring) return;
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  const tick = await hub.pulseTick().catch((error: unknown) => {
    console.warn("[pulse-tick]", error);
    return null;
  });
  if (!tick) return;
  await Promise.all([
    archiving && new PulseArchive({ coordinator: hub, db: env.HISTORY! }).run(tick.archive)
      .catch((error: unknown) => console.warn("[pulse-archive]", error)),
    scoring && new PulseScorer({ coordinator: hub, apiKey: env.TYPESAFE_API_KEY! }).run(tick.score)
      .catch((error: unknown) => console.warn("[pulse-score]", error)),
  ]);
}

export default Sentry.withSentry(sentryOptions, apiWorker);
