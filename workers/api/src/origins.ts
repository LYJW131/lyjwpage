/**
 * 来源白名单：`ALLOWED_ORIGINS` 一份名单，两条 WebSocket、CORS 和 MusicKit
 * 令牌签发都比它。从前 musickit-token 单独一个 Worker 时这几个函数抄了两份，
 * 并进来之后只剩这一份。
 */

export type OriginEnv = { ALLOWED_ORIGINS?: string };

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export function getAllowedOrigins(env: OriginEnv): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * 允许 `https://*.vercel.app` 这样的后缀通配。
 *
 * Vercel 的预览域名每次部署都换一个（`lyjwpage-<hash>-....vercel.app`），
 * 只做全等匹配的话，预览环境永远连不上。
 *
 * 按 hostname 的后缀比，不是按字符串包含 —— 后者会把
 * `https://vercel.app.evil.com` 也放进来。
 */
export function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  if (!pattern.includes("*")) return false;

  const wildcard = pattern.match(/^(https?:)\/\/\*\.(.+)$/);
  if (!wildcard) return false;
  const [, protocol, suffix] = wildcard;

  try {
    const url = new URL(origin);
    return url.protocol === protocol && url.hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

/** localhost 始终放行，不用写进名单 */
export function isAllowedOriginValue(origin: string, allowed: string[]): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return allowed.some((pattern) => originMatches(origin, pattern));
}

/**
 * 没配 ALLOWED_ORIGINS 就不限制 —— `wrangler dev` 不配也要能跑，而 localhost
 * 本来就始终放行。**配了之后，不带 Origin 头一律拒绝**：浏览器发 WebSocket
 * 握手和 fetch 时一定带这个头，所以卡死它对真实访客零代价，却堵上了「curl 不带头
 * 就绕过白名单」这个口子。
 *
 * 但别把这道闸当成全部的防护：Origin 头是请求方自己写的，非浏览器伪造一个就能
 * 过。对 MusicKit 令牌来说真正兜底的是签进 JWT 的 origin 声明，见 musickit-token.ts。
 */
export function isAllowedOrigin(request: Request, env: OriginEnv): boolean {
  const allowed = getAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  return isAllowedOriginValue(origin, allowed);
}

export function getCorsHeaders(request: Request, env: OriginEnv): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  const allowed = getAllowedOrigins(env);
  if (origin && (allowed.length === 0 || isAllowedOriginValue(origin, allowed))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  } else if (allowed.length === 0) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}
