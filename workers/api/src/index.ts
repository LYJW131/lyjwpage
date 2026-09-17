import originWorker from "./origin-worker";
import { getAllowedOrigins, getCorsHeaders, isAllowedOriginValue } from "./origins";
import { serveReadModel } from "./read-model-edge";
import { readModelEnabled, type Env } from "./runtime";

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
    const refresh = readModelEnabled(env)
      ? env.STATE.get(env.STATE.idFromName("global")).queueReadModels()
      : Promise.resolve();
    await Promise.all([originWorker.scheduled(event, env, ctx), refresh]);
  },
};
