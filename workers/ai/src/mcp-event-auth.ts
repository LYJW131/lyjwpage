import { createHash } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from 'jose';
import { MCP_PATH, MCP_RESOURCE_METADATA_PATH } from '@shared/ai-paths';

export interface McpEventAuthEnv {
  MCP_EVENT_AUTH?: string;
  MCP_EVENT_CLIENTS?: string;
  MCP_EVENT_CALLBACK_HOSTS?: string;
}

export const MCP_EVENT_AUTH_LIMITS = {
  tokenBytes: 8192,
  jwksBytes: 64 * 1024,
  jwksKeys: 32,
  jwksTimeoutMs: 5_000,
  jwksCacheMs: 5 * 60_000,
  jwksRefreshCooldownMs: 60_000,
} as const;

const EVENT_SCOPE = 'mcp:events';
const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
type EventClient = { principal: string; subject: string };
type AuthConfig = { issuer: string; resource: string; jwksUrl: string };
type JwksResolver = ReturnType<typeof createLocalJWKSet>;
type CachedJwks = {
  resolver: JwksResolver | null;
  kids: Set<string>;
  expiresAt: number;
  refreshAfter: number;
  pending?: Promise<void>;
};
const jwksCache = new Map<string, CachedJwks>();

function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search
      && (!url.port || url.port === '443') && DOMAIN.test(url.hostname)
      && !/\.(?:localhost|local|internal|arpa)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function eventAuthConfig(env: McpEventAuthEnv): AuthConfig | null {
  try {
    if (!env.MCP_EVENT_AUTH || env.MCP_EVENT_AUTH.length > 8192) return null;
    const value = JSON.parse(env.MCP_EVENT_AUTH);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !httpsUrl(value.issuer) || !httpsUrl(value.resource) || !httpsUrl(value.jwksUrl)
      || new URL(value.resource).pathname !== MCP_PATH
      || Object.keys(value).some((key) => !['issuer', 'resource', 'jwksUrl'].includes(key))) return null;
    return value as AuthConfig;
  } catch {
    return null;
  }
}

function eventClients(env: McpEventAuthEnv): EventClient[] {
  try {
    if ((env.MCP_EVENT_CLIENTS?.length ?? 0) > 64 * 1024) return [];
    const value: unknown = JSON.parse(env.MCP_EVENT_CLIENTS ?? '[]');
    if (!Array.isArray(value) || value.length > 100) return [];
    const principals = new Set<string>();
    const subjects = new Set<string>();
    for (const row of value) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.principal !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.principal)
        || typeof row.subject !== 'string' || !/^[^\x00-\x20\x7f]{1,256}$/.test(row.subject)
        || principals.has(row.principal) || subjects.has(row.subject)
        || Object.keys(row).some((key) => key !== 'principal' && key !== 'subject')) return [];
      principals.add(row.principal);
      subjects.add(row.subject);
    }
    return value as EventClient[];
  } catch {
    return [];
  }
}

function clientPrincipal(config: AuthConfig, client: EventClient): string {
  return `oauth_${createHash('sha256').update(JSON.stringify([config.issuer, config.resource, client.subject, client.principal])).digest('hex')}`;
}

export function eventCallbackHosts(env: McpEventAuthEnv): string[] {
  const hosts = (env.MCP_EVENT_CALLBACK_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (hosts.length > 20 || hosts.some((host) => host.length > 253 || !DOMAIN.test(host))) return [];
  return [...new Set(hosts)];
}

export function eventsConfigured(env: McpEventAuthEnv): boolean {
  return eventAuthConfig(env) !== null && eventClients(env).length > 0 && eventCallbackHosts(env).length > 0;
}

export function eventPrincipalAllowed(principal: string, env: McpEventAuthEnv): boolean {
  const config = eventAuthConfig(env);
  return config !== null && eventsConfigured(env) && eventClients(env).some((client) => clientPrincipal(config, client) === principal);
}

export function eventResourceMetadata(env: McpEventAuthEnv): Record<string, unknown> | null {
  const config = eventAuthConfig(env);
  if (!config || !eventsConfigured(env)) return null;
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [EVENT_SCOPE],
    bearer_methods_supported: ['header'],
  };
}

export function eventAuthChallenge(env: McpEventAuthEnv, error?: 'invalid_token' | 'insufficient_scope'): string | null {
  const config = eventAuthConfig(env);
  if (!config || !eventsConfigured(env)) return null;
  const resource = new URL(config.resource);
  const metadata = `${resource.origin}${MCP_RESOURCE_METADATA_PATH}`;
  return `Bearer resource_metadata="${metadata}", scope="${EVENT_SCOPE}"${error ? `, error="${error}"` : ''}`;
}

async function downloadJwks(url: string): Promise<{ resolver: JwksResolver; kids: Set<string> }> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal,
        });
        if (controller.signal.aborted || response.status !== 200 || !response.body) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error('JWKS unavailable');
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MCP_EVENT_AUTH_LIMITS.jwksBytes) throw new Error('JWKS unavailable');
          chunks.push(value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (!value || !Array.isArray(value.keys) || !value.keys.length || value.keys.length > MCP_EVENT_AUTH_LIMITS.jwksKeys) throw new Error('JWKS unavailable');
        const kids = new Set<string>();
        for (const key of value.keys) {
          if (!key || typeof key !== 'object' || Array.isArray(key) || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((name) => name in key)) throw new Error('JWKS unavailable');
          if (key.kty !== 'RSA' || (key.alg !== undefined && key.alg !== 'RS256') || (key.use !== undefined && key.use !== 'sig')) continue;
          if (typeof key.kid !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key.kid) || kids.has(key.kid)) throw new Error('JWKS unavailable');
          kids.add(key.kid);
        }
        return { resolver: createLocalJWKSet(value as JSONWebKeySet), kids };
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          void reader?.cancel().catch(() => undefined);
          reject(new Error('JWKS unavailable'));
        }, MCP_EVENT_AUTH_LIMITS.jwksTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    void reader?.cancel().catch(() => undefined);
  }
}

async function jwksFor(config: AuthConfig, kid: string): Promise<JwksResolver | null> {
  const key = JSON.stringify([config.issuer, config.jwksUrl]);
  let cached = jwksCache.get(key);
  if (!cached) {
    if (jwksCache.size >= 4) jwksCache.delete(jwksCache.keys().next().value!);
    cached = { resolver: null, kids: new Set(), expiresAt: 0, refreshAfter: 0 };
    jwksCache.set(key, cached);
  }
  const entry = cached;
  const now = Date.now();
  if (entry.expiresAt > now && entry.kids.has(kid)) return entry.resolver;
  if (!entry.pending && now >= entry.refreshAfter) {
    entry.refreshAfter = now + MCP_EVENT_AUTH_LIMITS.jwksRefreshCooldownMs;
    entry.pending = downloadJwks(config.jwksUrl).then(({ resolver, kids }) => {
      entry.resolver = resolver;
      entry.kids = kids;
      entry.expiresAt = Date.now() + MCP_EVENT_AUTH_LIMITS.jwksCacheMs;
    }).catch(() => undefined).finally(() => { entry.pending = undefined; });
  }
  await entry.pending;
  return entry.expiresAt > Date.now() && entry.kids.has(kid) ? entry.resolver : null;
}

export type EventAuthentication = {
  principal: string | null;
  expiresAt: number | null;
  failure: 'missing' | 'invalid_token' | 'insufficient_scope' | 'disabled' | null;
};

export async function eventAuthentication(request: Request, env: McpEventAuthEnv): Promise<EventAuthentication> {
  const config = eventAuthConfig(env);
  const failure = (reason: EventAuthentication['failure']): EventAuthentication => ({ principal: null, expiresAt: null, failure: reason });
  if (!config || !eventsConfigured(env)) return failure('disabled');
  const authorization = request.headers.get('Authorization');
  if (!authorization) return failure('missing');
  if (authorization.length > MCP_EVENT_AUTH_LIMITS.tokenBytes + 7) return failure('invalid_token');
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!match) return failure('invalid_token');
  try {
    const header = decodeProtectedHeader(match[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(header.kid)) return failure('invalid_token');
    const jwks = await jwksFor(config, header.kid);
    if (!jwks) return failure('invalid_token');
    const now = Math.floor(Date.now() / 1000);
    const { payload } = await jwtVerify(match[1], jwks, {
      algorithms: ['RS256'], issuer: config.issuer, audience: config.resource,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'], currentDate: new Date(now * 1000),
    });
    if (!Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.exp! * 1000) || !Number.isSafeInteger(payload.iat)
      || payload.iat! > now || payload.iat! < 0 || payload.exp! <= payload.iat!
      || (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf < 0 || payload.nbf >= payload.exp!))) return failure('invalid_token');
    const client = eventClients(env).find((entry) => entry.subject === payload.sub);
    if (!client) return failure('invalid_token');
    if (typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(EVENT_SCOPE)) return failure('insufficient_scope');
    return { principal: clientPrincipal(config, client), expiresAt: payload.exp! * 1000, failure: null };
  } catch {
    return failure('invalid_token');
  }
}

export async function authenticateEventPrincipal(request: Request, env: McpEventAuthEnv): Promise<string | null> {
  return (await eventAuthentication(request, env)).principal;
}
