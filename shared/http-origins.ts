export type OriginEnv = { ALLOWED_ORIGINS?: string };

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

export function getAllowedOrigins(env: OriginEnv): string[] {
  return (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

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

export function isAllowedOriginValue(origin: string, allowed: string[]): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return allowed.some((pattern) => originMatches(origin, pattern));
}

// 浏览器的同源 GET / HEAD 不带 Origin，只带 Sec-Fetch-Site: same-origin（页面脚本改不了这个头）；这时来源就是请求自己的源。
// site 经 Service Binding 转发时原样带着请求 URL，所以后端看到的仍是站点的源。
export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin) return origin;
  return request.headers.get("Sec-Fetch-Site") === "same-origin" ? new URL(request.url).origin : null;
}

export function isAllowedOrigin(request: Request, env: OriginEnv): boolean {
  const allowed = getAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = requestOrigin(request);
  if (!origin) return false;
  return isAllowedOriginValue(origin, allowed);
}

export function isForeignOrigin(request: Request, env: OriginEnv): boolean {
  const origin = request.headers.get("Origin");
  return !!origin && !isAllowedOriginValue(origin, getAllowedOrigins(env));
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
