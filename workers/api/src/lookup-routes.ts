import { APPLE_LOOKUPS } from "@shared/apple-lookups";
import { withRequestState } from "@shared/request-state";
import { defaultEdgeCache, edgeCacheRequest, serveWithEdgeCache } from "./edge-cache";
import { requestStore, type Env } from "./runtime";
import { createPublicStorage } from "./storage-driver";

export function isLookupPath(path: string): boolean {
  return APPLE_LOOKUPS.has(path);
}

export async function serveLookup(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const route = APPLE_LOOKUPS.get(url.pathname);
  if (!route) return new Response("Not found", { status: 404 });
  const key = route.edgeCacheKey(request);
  return serveWithEdgeCache({
    cache: defaultEdgeCache(),
    key: key ? edgeCacheRequest(url.origin, key) : null,
    waitUntil: (promise) => ctx.waitUntil(promise),
    origin: () => {
      const storage = createPublicStorage(env.STATE.get(env.STATE.idFromName("global")), () => env.STATE.get(env.STATE.idFromName("global")));
      return withRequestState(() => requestStore.run({ env, ctx, storage }, () => route.GET(request)));
    },
  });
}
