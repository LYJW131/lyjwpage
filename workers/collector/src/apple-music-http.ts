import { APPLE_LOOKUPS } from "@shared/apple-lookups";
import { MUSICKIT_TOKEN_PATH } from "@shared/apple-music-paths";
import { getCorsHeaders, isAllowedOrigin, isForeignOrigin, jsonResponse, requestOrigin } from "@shared/http-origins";
import { ConfigError, issueMusicKitToken } from "@shared/musickit-token";
import { withRequestState } from "@shared/request-state";
import { withPublicCors } from "@shared/status-response";

import type { Env } from "./env";

// 方法、来源与 CORS 头每次按这次请求判，这一层不能进缓存；查询本身交给开了 Workers Caching 的 AppleLookups，缓存里的响应不带 CORS 头。
export async function serveAppleMusic(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const cors = getCorsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (url.pathname === MUSICKIT_TOKEN_PATH) return issueToken(request, env, cors);
  if (!APPLE_LOOKUPS.has(url.pathname)) return new Response("Not found", { status: 404, headers: cors });
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
  if (isForeignOrigin(request, env)) return jsonResponse({ ok: false }, { status: 403, headers: cors });
  return withPublicCors(await env.APPLE_LOOKUPS.fetch(request), cors);
}

async function issueToken(request: Request, env: Env, cors: Headers): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: "只接受 GET" }, { status: 405, headers: cors });
  if (!isAllowedOrigin(request, env)) return jsonResponse({ error: "来源不在允许的域名内" }, { status: 403, headers: cors });
  try {
    const { token, issuedAt, expiresAt } = await issueMusicKitToken(requestOrigin(request), env);
    // 缓存令牌可能已消耗半段寿命，客户端必须用签发时刻而非收到时刻计算续期。
    return jsonResponse({ token, issuedAt, expiresAt }, { headers: cors });
  } catch (error) {
    console.error("[musickit-token] 签发失败：", error);
    const hint = error instanceof ConfigError ? error.hint : "签发失败，详情见 Worker 日志";
    return jsonResponse({ error: hint }, { status: 500, headers: cors });
  }
}

export function serveAppleLookup(request: Request): Promise<Response> {
  const lookup = APPLE_LOOKUPS.get(new URL(request.url).pathname);
  if (!lookup) return Promise.resolve(new Response("Not found", { status: 404 }));
  return withRequestState(() => lookup.GET(request));
}
