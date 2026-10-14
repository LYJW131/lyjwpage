import { BUILD_REPO } from "@shared/build-routine";
import { decodeBase64url } from "../crypto";
import { object, readBoundedJson } from "./http";

export const ACTIONS_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const ACTIONS_OIDC_JWKS_URL = `${ACTIONS_OIDC_ISSUER}/.well-known/jwks`;
export const BUILD_WORKFLOW_REF = `${BUILD_REPO}/.github/workflows/build.yml@refs/heads/main`;
// 名字在改名或删除后可被别人注册，数字 ID 不会复用；令牌里两者都是字符串。
export const BUILD_REPO_ID = "1331086735";
export const BUILD_REPO_OWNER_ID = "153256373";
// 受众把令牌绑到单个 run：同一回调源下，一张令牌不能替别的 run 报告或上传。须与 scripts/build-actions.mjs#workflowAudience 一致，两边的测试都核对这个格式。
export const buildWorkflowAudience = (callbackOrigin: string, runId: string) => `${callbackOrigin}/builds/${runId}`;
const MAX_TOKEN_CHARS = 8192;
const JWKS_MAX_BYTES = 64 * 1024;
const JWKS_TTL_MS = 60 * 60_000;
// 受众与 runId 都公开，任何人都能用未知 kid 或在缓存过期后触发重拉，重拉 JWKS 必须限速，不然每个伪造请求都会打到 GitHub。
const JWKS_REFETCH_MS = 60_000;
// 拉取与等待都以这个期限为界：workerd 里发起请求一旦被取消，它名下的拉取不会再结束，挂起超过期限的刷新视为已死。
const JWKS_FETCH_TIMEOUT_MS = 10_000;
const CLOCK_SKEW_S = 60;
const MAX_LIFETIME_S = 3600;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export class ActionsOidcUnavailableError extends Error {}

type KeyCache = { keys: Map<string, CryptoKey>; fetchedAt: number; attemptedAt: number; pending?: { promise: Promise<void>; startedAt: number } };
const keyCaches = new WeakMap<typeof fetch, KeyCache>();

const seconds = (value: unknown): value is number => Number.isSafeInteger(value);

function decodeJson(part: string): Record<string, unknown> | null {
  try { return object(JSON.parse(new TextDecoder().decode(decodeBase64url(part)))); } catch { return null; }
}

async function importKeys(data: unknown): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  const entries = object(data)?.keys;
  for (const entry of Array.isArray(entries) ? entries.slice(0, 32) : []) {
    const jwk = object(entry);
    if (!jwk || jwk.kty !== "RSA" || typeof jwk.kid !== "string" || typeof jwk.n !== "string" || typeof jwk.e !== "string") continue;
    if (jwk.use !== undefined && jwk.use !== "sig" || jwk.alg !== undefined && jwk.alg !== "RS256") continue;
    try { keys.set(jwk.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RSA, false, ["verify"])); } catch { continue; }
  }
  return keys;
}

async function loadKeys(fetcher: typeof fetch): Promise<Map<string, CryptoKey>> {
  const response = await fetcher(ACTIONS_OIDC_JWKS_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) }).catch(() => null);
  const keys = response?.ok ? await importKeys(await readBoundedJson(response, JWKS_MAX_BYTES)) : new Map<string, CryptoKey>();
  if (!keys.size) throw new ActionsOidcUnavailableError("GitHub Actions signing keys are unavailable.");
  return keys;
}

function refresh(cache: KeyCache, fetcher: typeof fetch, now: number): NonNullable<KeyCache["pending"]> {
  cache.attemptedAt = now;
  const promise: Promise<void> = loadKeys(fetcher).then((keys) => { cache.keys = keys; cache.fetchedAt = now; }).finally(() => { if (cache.pending?.promise === promise) cache.pending = undefined; });
  return cache.pending = { promise, startedAt: now };
}

function settleWithin(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ActionsOidcUnavailableError("GitHub Actions signing keys are unavailable.")), Math.max(0, ms)); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

async function signingKey(kid: string, fetcher: typeof fetch, now: number): Promise<CryptoKey | null> {
  let cache = keyCaches.get(fetcher);
  if (!cache) keyCaches.set(fetcher, cache = { keys: new Map(), fetchedAt: -Infinity, attemptedAt: -Infinity });
  const live = cache.pending && now - cache.pending.startedAt < JWKS_FETCH_TIMEOUT_MS ? cache.pending : undefined;
  const cached = cache.keys.has(kid);
  // 公钥已在缓存里就不等别的请求发起的刷新：那次拉取归发起它的请求，等它等于把本请求的生死交给别人。
  let refreshing = live && !cached ? live : undefined;
  if (!live && (!cached || now - cache.fetchedAt >= JWKS_TTL_MS) && now - cache.attemptedAt >= JWKS_REFETCH_MS) refreshing = refresh(cache, fetcher, now);
  if (refreshing) {
    // 刷新失败时沿用缓存里的公钥：GitHub 一时拉不到，不该让正在跑的构建验不过。
    try { await settleWithin(refreshing.promise, JWKS_FETCH_TIMEOUT_MS - (now - refreshing.startedAt)); } catch (error) { if (!cache.keys.has(kid)) throw error; }
  }
  if (!cache.keys.size) throw new ActionsOidcUnavailableError("GitHub Actions signing keys are unavailable.");
  return cache.keys.get(kid) ?? null;
}

function trustedClaims(claims: Record<string, unknown>, audience: string, now: number): boolean {
  const nowS = Math.floor(now / 1000);
  const { aud, iat, nbf, exp } = claims;
  return claims.iss === ACTIONS_OIDC_ISSUER
    && (aud === audience || Array.isArray(aud) && aud.includes(audience))
    && claims.repository === BUILD_REPO
    && claims.repository_id === BUILD_REPO_ID
    && claims.repository_owner_id === BUILD_REPO_OWNER_ID
    && claims.workflow_ref === BUILD_WORKFLOW_REF
    // 实测普通 job 的令牌也带 job_workflow_ref（等于 workflow_ref），但 GitHub 文档只对可复用工作流承诺它；缺失时只靠 workflow_ref，出现时必须也是 build.yml，挡住 build.yml 调用的其他可复用工作流。
    && (claims.job_workflow_ref === undefined || claims.job_workflow_ref === BUILD_WORKFLOW_REF)
    && claims.event_name === "repository_dispatch"
    && claims.ref === "refs/heads/main"
    && claims.runner_environment === "github-hosted"
    && seconds(exp) && seconds(iat) && exp > nowS && iat <= nowS + CLOCK_SKEW_S && exp > iat && exp - iat <= MAX_LIFETIME_S
    && (nbf === undefined || seconds(nbf) && nbf <= nowS + CLOCK_SKEW_S);
}

// 只证明调用来自 main 上的 build.yml、由 repository_dispatch 触发、受众是调用方给的值；调用方用 buildWorkflowAudience 把它绑到具体 run。
export async function verifyActionsToken(token: string, audience: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Record<string, unknown> | null> {
  if (!audience || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.crit !== undefined) return null;
  if (!trustedClaims(claims, audience, now)) return null;
  const key = await signingKey(header.kid, fetcher, now);
  if (!key) return null;
  try {
    return await crypto.subtle.verify(RSA, key, decodeBase64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)) ? claims : null;
  } catch { return null; }
}
