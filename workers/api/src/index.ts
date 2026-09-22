import originWorker from "./origin-worker";
import { getAllowedOrigins, getCorsHeaders, isAllowedOriginValue } from "./origins";
import { previewWorkerEnabled } from "./preview";
import { serveReadModel } from "./read-model-edge";
import { historyArchiveEnabled, pulseScoringEnabled, readModelEnabled, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer } from "./pulse-score";

// Keep Wrangler's existing class exports and DO migration identities unchanged.
export { LivePushRoom, StateHub } from "./origin-worker";
export { ReadModelRenderer } from "./read-model-renderer";
export type { Env } from "./runtime";

const apiWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    return serveReadModel(request, {
      kv: env.READ_MODEL,
      prefix: env.STORAGE_PREFIX ?? "lyjwpage",
      enabled: readModelEnabled(env),
      allowedOrigin: !origin || isAllowedOriginValue(origin, getAllowedOrigins(env)),
      cors: getCorsHeaders(request, env),
      origin: () => originWorker.fetch(request, env, ctx),
      refresh: (path) => {
        ctx.waitUntil(env.STATE.get(env.STATE.idFromName("global")).queueReadModels([path])
          .catch((error: unknown) => console.warn("[read-model enqueue]", error)));
      },
    });
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // 影子脚本不挂 cron。这里再挡一次，避免有人把生产的分钟触发抄到预览配置上，
    // 每个分支都去打 PageSpeed 和 Apple。
    if (previewWorkerEnabled()) return;
    // Rebuilds also cover external API caches, elapsed-time views and bindings added
    // to an already initialized StateHub. No visitor is needed to finish a retry.
    // Enqueue only after the origin cron (Apple recently played, PageSpeed, agent status) has written,
    // so the listening projection is rendered from the refreshed list, not the previous one.
    await originWorker.scheduled(event, env, ctx);
    const hub = env.STATE.get(env.STATE.idFromName("global"));
    if (readModelEnabled(env)) await hub.queueReadModels();
    // Archiving trails the projection: it only appends to D1, is read by nobody yet, and
    // must not delay this minute's public views. The ordinary Worker runner isolates
    // per-domain failures; this catch keeps an unexpected coordinator failure from failing the cron tick.
    if (historyArchiveEnabled(env)) {
      await new PulseArchive({ coordinator: hub, db: env.HISTORY! }).run()
        .catch((error: unknown) => console.warn("[pulse-archive]", error));
    }
    // 活动分同理排在最后：统一五分钟分段评分才调外部模型，这一分钟的公开视图不等它。
    if (pulseScoringEnabled(env)) {
      await new PulseScorer({ coordinator: hub, apiKey: env.TYPESAFE_API_KEY! }).run()
        .catch((error: unknown) => console.warn("[pulse-score]", error));
    }
  },
};

export default apiWorker;
