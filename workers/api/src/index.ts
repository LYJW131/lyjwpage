import * as Sentry from "@sentry/cloudflare";

import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import { previewWorkerEnabled } from "./preview";
import { historyArchiveEnabled, pulseScoringEnabled, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer } from "./pulse-score";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { CRON_MONITOR_CONFIG, CRON_MONITOR_SLUG, heartbeatDue } from "./cron-heartbeat";
import { sentryOptions } from "./sentry";

// Keep Wrangler's existing class exports and DO migration identities unchanged:
// bindings and migrations key on these export names, the Sentry wrappers only subclass them.
export const LivePushRoom = Sentry.instrumentDurableObjectWithSentry(sentryOptions, LivePushRoomBase);
export const StateHub = Sentry.instrumentDurableObjectWithSentry(sentryOptions, StateHubBase);
/** 上报入口与采集 Worker 经 Service Binding 调的状态核心 RPC，契约见 shared/state-core.ts */
export const StateCore = Sentry.withSentry(sentryOptions, StateCoreBase);
/** 只在本地绑定：LivePushRoom 转发上游推送前查假数据注入 */
export const DevOverrideReader = Sentry.withSentry(sentryOptions, DevOverrideReaderBase);
export type { Env } from "./runtime";

const apiWorker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return originWorker.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // 影子脚本不挂 cron。这里再挡一次，避免有人把生产的分钟触发抄到预览配置上，
    // 每个分支都去往共享的归档和评分里写。
    if (previewWorkerEnabled()) return;
    // 每 5 分钟那一轮才包上心跳，其余几轮照常跑、不往 Sentry 报到
    if (!heartbeatDue(event.scheduledTime)) return runScheduled(env);
    await Sentry.withMonitor(CRON_MONITOR_SLUG, () => runScheduled(env), CRON_MONITOR_CONFIG);
  },
};

/**
 * 分钟 cron 做 pulse 的两件事，外部拉取都在采集 Worker。归档写 D1，
 * 评分才调外部模型；两件各自兜底，一件失败不拖累另一件，也不让这一轮心跳报错。
 */
async function runScheduled(env: Env): Promise<void> {
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  if (historyArchiveEnabled(env)) {
    await new PulseArchive({ coordinator: hub, db: env.HISTORY! }).run()
      .catch((error: unknown) => console.warn("[pulse-archive]", error));
  }
  if (pulseScoringEnabled(env)) {
    await new PulseScorer({ coordinator: hub, apiKey: env.TYPESAFE_API_KEY! }).run()
      .catch((error: unknown) => console.warn("[pulse-score]", error));
  }
}

export default Sentry.withSentry(sentryOptions, apiWorker);
