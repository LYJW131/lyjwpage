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
 * 本地没有 Access：`ACCESS_TEAM_DOMAIN` 设成 DEV_ACCESS_ISSUER 时改用 `ACCESS_DEV_JWKS` 里的
 * 测试公钥，由 scripts/dev-access.mjs 生成、签 JWT。只认这个假域名，线上误配这个变量也不生效。
 */

import { verifyAccessJwt, type Jwk } from "@shared/access-jwt";

import type { Env } from "./runtime";

/** 权限串：`ingest:<来源>` 写上报，`internal:site-deployed` 发部署通知。 */
export type Permission = `ingest:${string}` | "internal:site-deployed";

export type AuthResult =
  | { ok: true; clientId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type AccessEnv = Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ACCESS_CLIENTS" | "ACCESS_DEV_JWKS">;

/** 本地开发专用的 team 域名，.invalid 保证它永远解析不到真实服务。 */
export const DEV_ACCESS_ISSUER = "https://access.local.invalid";

export function devJwks(env: Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_DEV_JWKS">): Jwk[] | undefined {
  if (env.ACCESS_TEAM_DOMAIN?.trim() !== DEV_ACCESS_ISSUER || !env.ACCESS_DEV_JWKS) return undefined;
  return (JSON.parse(env.ACCESS_DEV_JWKS) as { keys: Jwk[] }).keys;
}

function allowedFor(env: AccessEnv, clientId: string): readonly string[] {
  const table = env.ACCESS_CLIENTS;
  if (!table || typeof table !== "object") return [];
  const entry = (table as Record<string, unknown>)[clientId];
  return Array.isArray(entry) ? entry.filter((item): item is string => typeof item === "string") : [];
}

export async function authorize(request: Request, env: AccessEnv, permission: Permission): Promise<AuthResult> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) {
    let clientId: string | null;
    try {
      const claims = await verifyAccessJwt(assertion, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, jwks: devJwks(env) });
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
    return { ok: true, clientId };
  }
  return { ok: false, status: 401, error: "未授权" };
}
