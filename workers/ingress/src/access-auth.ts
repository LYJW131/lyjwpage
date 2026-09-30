import { verifyAccessJwt, type Jwk } from "@shared/access-jwt";

import type { Env } from "./env";

export type Permission = `ingest:${string}` | "internal:site-deployed";

export type AuthResult =
  | { ok: true; clientId: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type AccessEnv = Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ACCESS_CLIENTS" | "ACCESS_DEV_JWKS">;

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
