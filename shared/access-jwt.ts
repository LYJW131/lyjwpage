/**
 * Cloudflare Access JWT 校验，api 与 playstation-reporter 两个 Worker 共用。
 *
 * Access 挡在边缘，放行的请求带着它签的 JWT 到 Worker。Worker 仍要自己验一遍：
 * 同一个 Worker 还能从 workers.dev 或别的域名进来，那条路不过 Access，只有这张
 * 签名验得过的 JWT 才说明请求真的过了门。只用 WebCrypto，不依赖 Node 兼容层。
 */

export type Jwk = JsonWebKey & { kid?: string };
type JwtHeader = { alg?: string; kid?: string };
type JwtPayload = {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  common_name?: string;
  email?: string;
};

const JWKS_TTL_MS = 60 * 60_000;
const JWKS_REFETCH_COOLDOWN_MS = 60_000;
let jwksCache: { issuer: string; at: number; keys: Map<string, CryptoKey> } | null = null;

/** 测试注入：替换公钥来源，不去网络拉 JWKS。 */
let jwksFetcher: (issuer: string) => Promise<Jwk[]> = async (issuer) => {
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`拉 Access 公钥失败：${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  return body.keys ?? [];
};

export function setJwksFetcherForTests(fetcher: ((issuer: string) => Promise<Jwk[]>) | null): void {
  jwksCache = null;
  if (fetcher) jwksFetcher = fetcher;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function base64UrlDecode(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as T;
}

async function importKeys(jwks: Jwk[]): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keys.set(jwk.kid, key);
  }
  return keys;
}

/**
 * 按 kid 取公钥；缓存一小时。遇到没见过的 kid（Access 轮换了签名钥匙）重拉一次，
 * 但一分钟内最多一次 —— 否则谁都能拿随便编的 kid 让 Worker 每个请求都出网一趟。
 */
async function keyFor(issuer: string, kid: string, now: number): Promise<CryptoKey | null> {
  const cached = jwksCache && jwksCache.issuer === issuer ? jwksCache : null;
  if (cached && now - cached.at < JWKS_TTL_MS) {
    const key = cached.keys.get(kid);
    if (key) return key;
    if (now - cached.at < JWKS_REFETCH_COOLDOWN_MS) return null;
  }
  jwksCache = { issuer, at: now, keys: await importKeys(await jwksFetcher(issuer)) };
  return jwksCache.keys.get(kid) ?? null;
}

export type AccessJwtClaims = { commonName: string | null; email: string | null };

/**
 * 验 Cloudflare Access 签的 JWT（`Cf-Access-Jwt-Assertion`）：RS256 验签、受众、签发方、时效。
 * 通过返回里面的身份 —— service token 是 `common_name`（= client id），人登录是 `email`；
 * 任何一项不对都返回 null。`teamDomain` 形如 `https://<team>.cloudflareaccess.com`。
 */
export async function verifyAccessJwt(
  token: string,
  options: { teamDomain?: string; audience?: string; jwks?: Jwk[] },
  now = Date.now(),
): Promise<AccessJwtClaims | null> {
  const issuer = options.teamDomain?.trim() ? trimSlash(options.teamDomain.trim()) : "";
  const audience = options.audience?.trim() ?? "";
  if (!issuer || !audience) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeJson<JwtHeader>(headerPart);
    payload = decodeJson<JwtPayload>(payloadPart);
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  // 本地开发与隔离验证传进来一份测试公钥，不出网；线上一律从 team 域名拉
  const key = options.jwks ? (await importKeys(options.jwks)).get(header.kid) ?? null : await keyFor(issuer, header.kid, now);
  if (!key) return null;
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return null;

  const seconds = now / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return null;
  if (payload.iss !== issuer) return null;
  if (typeof payload.exp !== "number" || payload.exp < seconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf > seconds + 60) return null;
  const commonName = typeof payload.common_name === "string" && payload.common_name ? payload.common_name : null;
  const email = typeof payload.email === "string" && payload.email ? payload.email : null;
  return commonName || email ? { commonName, email } : null;
}
