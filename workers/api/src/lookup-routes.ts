import { withRequestState } from "@shared/request-state";
import { defaultEdgeCache, edgeCacheRequest, serveWithEdgeCache } from "./edge-cache";
import * as lyrics from "./routes/lyrics/route";
import * as motionArtwork from "./routes/motion-artwork/route";
import { requestStore, type Env } from "./runtime";
import { createPublicStorage } from "./storage-driver";

type LookupRoute = {
  GET(request: Request): Promise<Response>;
  edgeCacheKey(request: Request): string | null;
};

/**
 * 按键查询的公开路由：结果只由参数决定，没有 `{ok}` 信封，也不是状态视图。
 * 和上报的提交顺序无关，所以不过 StateHub 的公开读屏障；未初始化时 `publicRead`
 * 仍会拒绝，由路由自己的 catch 回 500。
 */
const LOOKUP_ROUTES: Record<string, LookupRoute> = {
  "/api/lyrics": lyrics,
  "/api/motion-artwork": motionArtwork,
};

export function isLookupPath(path: string): boolean {
  return Object.hasOwn(LOOKUP_ROUTES, path);
}

export async function serveLookup(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const route = LOOKUP_ROUTES[url.pathname];
  if (!route) return new Response("Not found", { status: 404 });
  const key = route.edgeCacheKey(request);
  return serveWithEdgeCache({
    cache: defaultEdgeCache(),
    key: key ? edgeCacheRequest(url.origin, key) : null,
    waitUntil: (promise) => ctx.waitUntil(promise),
    origin: () => {
      const storage = createPublicStorage(env.STATE.get(env.STATE.idFromName("global")));
      return withRequestState(() => requestStore.run({ env, ctx, storage }, () => route.GET(request)));
    },
  });
}
