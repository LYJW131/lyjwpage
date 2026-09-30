// Worker 域名也能绕过 Access 边缘入口，必须独立验证 JWT。

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
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
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

// 限制未知 kid 的重拉频率，避免伪造 kid 让每个请求都触发出网。
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
