import originWorker from "./origin-worker";
import { getAllowedOrigins, getCorsHeaders, isAllowedOriginValue } from "./origins";
import { serveReadModel } from "./read-model-edge";
import { historyArchiveEnabled, readModelEnabled, type Env } from "./runtime";

// Keep Wrangler's existing class exports and DO migration identities unchanged.
export { LivePushRoom, StateHub } from "./origin-worker";
export type { Env } from "./runtime";

export default {
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
    // Rebuilds also cover external API caches, elapsed-time views and bindings added
    // to an already initialized StateHub. No visitor is needed to finish a retry.
    // Enqueue only after the origin cron (Apple recently played, PageSpeed) has written,
    // so the listening projection is rendered from the refreshed list, not the previous one.
    await originWorker.scheduled(event, env, ctx);
    const hub = env.STATE.get(env.STATE.idFromName("global"));
    if (readModelEnabled(env)) await hub.queueReadModels();
    // Archiving trails the projection: it only appends to D1, is read by nobody yet, and
    // must not delay this minute's public views. The RPC swallows per-domain failures;
    // this catch is for the transport itself, which would otherwise fail the cron tick.
    if (historyArchiveEnabled(env)) {
      await hub.archivePulse().catch((error: unknown) => console.warn("[pulse-archive]", error));
    }
  },
};
