/**
 * 上报与内部通知的鉴权。
 *
 * 新路：Cloudflare Access。上报器带着自己的 service token（`CF-Access-Client-Id` /
 * `CF-Access-Client-Secret`）打 `ingest.homepage.lyjw.llc`，Access 在边缘核对 token，
 * 放行时附上一张它签的 JWT（`Cf-Access-Jwt-Assertion`）。这里只信那张 JWT：验签、
 * 验受众和签发方、验时效，再拿 `common_name`（= client id）查 ACCESS_CLIENTS，
 * 看这把 token 许不许写这个来源。边缘那道门挡陌生人，这张表管「谁能写什么」，
 * 而且跟着 Git 走。绕过 Access 直接打 workers.dev 或 api 域名的请求拿不出合法 JWT。
 *
 * 旧路：共用的 TELEMETRY_INGEST_SECRET（Bearer）。过渡期保留，用到就记一条
 * `[auth] 旧 Bearer` 日志，日志里不再出现某个来源时说明它迁完了；全部迁完后删掉这条路。
 */

import { timingSafeEqual } from "node:crypto";

import { verifyAccessJwt } from "@shared/access-jwt";

import type { Env } from "./runtime";

/** 权限串：`ingest:<来源>` 写上报，`internal:site-deployed` 发部署通知。 */
export type Permission = `ingest:${string}` | "internal:site-deployed";

export type AuthResult =
  | { ok: true; via: "access"; clientId: string }
  | { ok: true; via: "legacy-bearer" }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type AccessEnv = Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ACCESS_CLIENTS" | "TELEMETRY_INGEST_SECRET">;

function allowedFor(env: AccessEnv, clientId: string): readonly string[] {
  const table = env.ACCESS_CLIENTS;
  if (!table || typeof table !== "object") return [];
  const entry = (table as Record<string, unknown>)[clientId];
  return Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
}

function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

export async function authorize(request: Request, env: AccessEnv, permission: Permission): Promise<AuthResult> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) {
    let clientId: string | null;
    try {
      const claims = await verifyAccessJwt(assertion, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD });
      clientId = claims?.commonName ?? null;
    } catch (error) {
      console.error("[auth] 验 Access JWT 出错", error);
      return { ok: false, status: 503, error: "暂时无法校验 Access 凭据" };
    }
    if (!clientId) return { ok: false, status: 401, error: "未授权" };
    if (!allowedFor(env, clientId).includes(permission)) {
      console.warn("[auth] 越权", clientId, permission);
      return { ok: false, status: 403, error: "这把凭据不能做这件事" };
    }
    return { ok: true, via: "access", clientId };
  }

  const expected = env.TELEMETRY_INGEST_SECRET;
  const provided = bearerToken(request);
  if (expected && provided && secretMatches(provided, expected)) {
    // log 而不是 warn：Sentry 只收 warn / error，这条每封旧上报都打，别刷进 Sentry Logs。
    // 迁移进度看 Workers 日志里还有没有它
    console.log("[auth] 旧 Bearer", permission);
    return { ok: true, via: "legacy-bearer" };
  }
  return { ok: false, status: 401, error: "未授权" };
}
