// 测试的 Node 导入钩子只解析别名，不能改为无扩展名的相对导入。
import { getAllowedOrigins, type OriginEnv } from "@api/origins";
import { pastHalfLife } from "@shared/token-lifetime";

export { pastHalfLife } from "@shared/token-lifetime";

// 公开 developer token 不能复用含私人 music user token 的凭据路径，否则会泄露收听权限。

export interface MusicKitTokenEnv extends OriginEnv {
  APPLE_MUSIC_PRIVATE_KEY?: string;
  APPLE_MUSIC_KEY_ID?: string;
  APPLE_MUSIC_TEAM_ID?: string;
  MUSICKIT_TOKEN_TTL_SECONDS?: string;
}

export const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_TTL_SECONDS = 15777000;

export type IssuedToken = { token: string; issuedAt: number; expiresAt: number };

export class ConfigError extends Error {
  readonly hint: string;
  constructor(hint: string) {
    super(hint);
    this.hint = hint;
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodePkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

let signingKey: { pem: string; key: CryptoKey } | null = null;

async function importSigningKey(env: MusicKitTokenEnv): Promise<CryptoKey> {
  const raw = env.APPLE_MUSIC_PRIVATE_KEY?.trim();
  if (!raw) throw new ConfigError("没有配置 APPLE_MUSIC_PRIVATE_KEY");
  if (signingKey?.pem === raw) return signingKey.key;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePkcs8(raw),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  signingKey = { pem: raw, key };
  return key;
}

// Apple 不解析 origin 通配符；预览域和 localhost 只能签自身，不能附带生产域授权。
export function signedOrigins(origin: string | null, allowed: string[]): string[] {
  if (allowed.length === 0) return [];

  const literal = allowed.filter((pattern) => !pattern.includes("*"));
  if (!origin) return literal;
  return literal.includes(origin) ? literal : [origin];
}

export function resolveTtlSeconds(env: MusicKitTokenEnv): number {
  const raw = Number(env.MUSICKIT_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(Math.floor(raw), MAX_TTL_SECONDS);
}

const tokenCache = new Map<string, IssuedToken>();
const TOKEN_CACHE_LIMIT = 32;

export async function issueMusicKitToken(
  origin: string | null,
  env: MusicKitTokenEnv,
  { now = Math.floor(Date.now() / 1000), cache = tokenCache }: { now?: number; cache?: Map<string, IssuedToken> } = {},
): Promise<IssuedToken> {
  const teamId = env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = env.APPLE_MUSIC_KEY_ID?.trim();
  if (!teamId) throw new ConfigError("没有配置 APPLE_MUSIC_TEAM_ID");
  if (!keyId) throw new ConfigError("没有配置 APPLE_MUSIC_KEY_ID");

  const origins = signedOrigins(origin, getAllowedOrigins(env));
  const cacheKey = origins.join(",");

  const cached = cache.get(cacheKey);
  if (cached && !pastHalfLife(cached, now)) return cached;

  const issued = await signDeveloperToken({ teamId, keyId, origins }, env, now);
  if (cache.size >= TOKEN_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, issued);
  return issued;
}

const apiTokenCache: { current: IssuedToken | null } = { current: null };

export async function issueApiDeveloperToken(
  env: MusicKitTokenEnv,
  { now = Math.floor(Date.now() / 1000), cache = apiTokenCache }: { now?: number; cache?: { current: IssuedToken | null } } = {},
): Promise<IssuedToken> {
  const teamId = env.APPLE_MUSIC_TEAM_ID?.trim();
  const keyId = env.APPLE_MUSIC_KEY_ID?.trim();
  if (!teamId) throw new ConfigError("没有配置 APPLE_MUSIC_TEAM_ID");
  if (!keyId) throw new ConfigError("没有配置 APPLE_MUSIC_KEY_ID");

  if (cache.current && !pastHalfLife(cache.current, now)) return cache.current;
  const issued = await signDeveloperToken({ teamId, keyId, origins: [] }, env, now);
  cache.current = issued;
  return issued;
}

async function signDeveloperToken(
  claims: { teamId: string; keyId: string; origins: string[] },
  env: MusicKitTokenEnv,
  now: number,
): Promise<IssuedToken> {
  const expiresAt = now + resolveTtlSeconds(env);
  const header = { alg: "ES256", kid: claims.keyId };
  const payload = {
    iss: claims.teamId,
    iat: now,
    exp: expiresAt,
    // 空 origin 数组会被 Apple 当作全部拒绝；无限制时必须省略该声明。
    ...(claims.origins.length > 0 ? { origin: claims.origins } : {}),
  };

  const signingInput = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importSigningKey(env),
    new TextEncoder().encode(signingInput),
  );

  // WebCrypto 已返回 JWS 要的定长 r‖s；加 DER 封装会让 Apple 拒绝签名。
  const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return { token, issuedAt: now, expiresAt };
}
