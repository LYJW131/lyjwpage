import { timingSafeEqual } from 'node:crypto';

export interface McpEventAuthEnv {
  MCP_EVENT_CLIENTS?: string;
  MCP_EVENT_CALLBACK_HOSTS?: string;
}

type EventClient = { principal: string; tokenSha256: string };

function eventClients(env: McpEventAuthEnv): EventClient[] {
  try {
    const value: unknown = JSON.parse(env.MCP_EVENT_CLIENTS ?? '[]');
    if (!Array.isArray(value) || value.length > 100) return [];
    const principals = new Set<string>();
    const hashes = new Set<string>();
    for (const row of value) {
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || typeof row.principal !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.principal)
        || typeof row.tokenSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenSha256)
        || principals.has(row.principal) || hashes.has(row.tokenSha256)
        || Object.keys(row).some((key) => key !== 'principal' && key !== 'tokenSha256')) return [];
      principals.add(row.principal);
      hashes.add(row.tokenSha256);
    }
    return value as EventClient[];
  } catch {
    return [];
  }
}

export function eventCallbackHosts(env: McpEventAuthEnv): string[] {
  const hosts = (env.MCP_EVENT_CALLBACK_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
  if (hosts.length > 20 || hosts.some((host) => host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/.test(host))) return [];
  return [...new Set(hosts)];
}

export function eventsConfigured(env: McpEventAuthEnv): boolean {
  return eventClients(env).length > 0 && eventCallbackHosts(env).length > 0;
}

export function eventPrincipalAllowed(principal: string, env: McpEventAuthEnv): boolean {
  return eventsConfigured(env) && eventClients(env).some((client) => client.principal === principal);
}

export async function authenticateEventPrincipal(request: Request, env: McpEventAuthEnv): Promise<string | null> {
  if (!eventsConfigured(env)) return null;
  const match = /^Bearer ([\x21-\x7e]{32,512})$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) return null;
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1])));
  let principal: string | null = null;
  for (const client of eventClients(env)) {
    if (timingSafeEqual(digest, Buffer.from(client.tokenSha256, 'hex'))) principal = client.principal;
  }
  return principal;
}
