import { requestState } from "@shared/request-state";
import { get, put, remove } from "@/lib/apple-cache";


let cachedToken: string | null = null;
let tokenExpiresAt = 0;
const tokenRequest = () => requestState("web-token", () => ({ inflight: null as Promise<string> | null }));

const TOKEN_CACHE_KEY = "apple-web-token";

type StoredToken = { token: string; expiresAt: number };

export const APPLE_WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const APPLE_UPSTREAM_TIMEOUT_MS = 10_000;

export class AppleUpstreamError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.status = status;
  }
}

export async function getWebToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  tokenRequest().inflight ??= loadWebToken().finally(() => {
    tokenRequest().inflight = null;
  });
  return tokenRequest().inflight!;
}

async function loadWebToken(): Promise<string> {
  const stored = await get<StoredToken>(TOKEN_CACHE_KEY);
  if (stored?.token && Date.now() < stored.expiresAt) {
    cachedToken = stored.token;
    tokenExpiresAt = stored.expiresAt;
    return stored.token;
  }

  const token = await scrapeWebToken();
  await put(TOKEN_CACHE_KEY, { token, expiresAt: tokenExpiresAt }, tokenExpiresAt - Date.now());
  return token;
}

async function scrapeWebToken(): Promise<string> {
  const htmlResp = await fetch("https://music.apple.com", {
    headers: { "User-Agent": APPLE_WEB_USER_AGENT },
    signal: AbortSignal.timeout(APPLE_UPSTREAM_TIMEOUT_MS),
  });
  if (!htmlResp.ok) throw new AppleUpstreamError(`music.apple.com ${htmlResp.status}`);
  const html = await htmlResp.text();
  const jsMatch = html.match(/\/assets\/index~[^"']+\.js/);
  if (!jsMatch) throw new AppleUpstreamError("No JS bundle");

  const jsResp = await fetch("https://music.apple.com" + jsMatch[0], {
    headers: { "User-Agent": APPLE_WEB_USER_AGENT },
    signal: AbortSignal.timeout(APPLE_UPSTREAM_TIMEOUT_MS),
  });
  if (!jsResp.ok) throw new AppleUpstreamError(`JS bundle ${jsResp.status}`);
  const jsContent = await jsResp.text();
  const jwtMatch = jsContent.match(/eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+/);
  if (!jwtMatch) throw new AppleUpstreamError("No JWT");

  cachedToken = jwtMatch[0];
  tokenExpiresAt = tokenRefreshAt(parseJwtExp(cachedToken));
  return cachedToken;
}

// 过期 token 仍要保留最短刷新间隔，避免每个请求重复抓取同一份坏 token。
function tokenRefreshAt(expMs: number): number {
  const now = Date.now();
  // 取整：/2 有一半概率除出 x.5，而这个值既存进 Storage 也当 TTL 用
  return now + Math.max(Math.ceil((expMs - now) / 2), 60 * 60 * 1000);
}

function parseJwtExp(jwt: string): number {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2 || !parts[1]) return Date.now() + 24 * 60 * 60 * 1000;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (payload.exp && typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {}
  return Date.now() + 24 * 60 * 60 * 1000;
}

// 迟到的 401 只能作废该请求使用的 token，不能删掉并发刷新得到的新值。
export async function ampFetch<T>(
  endpoint: string,
  token: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      "User-Agent": APPLE_WEB_USER_AGENT,
      ...headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(APPLE_UPSTREAM_TIMEOUT_MS),
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      // 先删持久副本再清全局，避免并发读取把失效 token 从存储重新装回内存。
      const stored = await get<StoredToken>(TOKEN_CACHE_KEY);
      if (stored?.token === token) await remove(TOKEN_CACHE_KEY);
      if (cachedToken === token) cachedToken = null;
    }
    throw new AppleUpstreamError(`amp-api ${resp.status}`, resp.status);
  }

  return (await resp.json()) as T;
}
