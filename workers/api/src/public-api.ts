import { get as cacheGet, put as cachePut } from "@/lib/cache";
import {
  sinceDateParam,
  sinceParam,
  statusEnvelope,
  statusResponse,
  titleIdsParam,
} from "@/lib/api";
import { loadEndpoint, type StatusLoaderParams } from "@/lib/status-loaders";
import { pathByEvent, viewKeyByPath } from "@/lib/status-views";
import {
  DEV_OVERRIDE_ENABLED_KEY,
  DEV_OVERRIDE_INDEX_KEY,
  DEV_OVERRIDE_KEY,
  DEV_OVERRIDE_PREFIX,
  DEV_OVERRIDES_LIST_PATH,
  DEV_OVERRIDE_TTL_MS,
} from "./dev-overrides";
import { currentContext } from "./runtime";

// 本地空库也可能返回 ok:true 空态，必须上游优先，否则空态会遮住生产数据。
const UPSTREAM_TIMEOUT_MS = 10_000;

function upstreamBase(): string | null {
  const value = process.env.UPSTREAM_API_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

type Envelope = { ok: boolean; [field: string]: unknown };

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
}

function withServedAt(envelope: Envelope): Envelope {
  return envelope.ok && typeof envelope.servedAt !== "number" ? { ...envelope, servedAt: Date.now() } : envelope;
}

async function fetchUpstreamJson(base: string, pathWithSearch: string): Promise<unknown> {
  try {
    const response = await fetch(`${base}${pathWithSearch}`, {
      headers: { Accept: "application/json", "User-Agent": "lyjwpage-dev-upstream" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn("[upstream]", pathWithSearch, error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function overlayResponse(local: Response, load: () => Promise<unknown>): Promise<Response> {
  const body: unknown = await local.clone().json().catch(() => null);
  if (!isEnvelope(body)) return local;
  const theirs = await load();
  if (!isEnvelope(theirs) || !theirs.ok) return local;
  return Response.json(withServedAt(theirs), { status: 200, headers: local.headers });
}

export const devOverridesEnabled = (): boolean => process.env.DEV_OVERRIDES?.trim() === "true";

export function isPublicApiPath(path: string): boolean {
  if (viewKeyByPath(path)) return true;
  return devOverridesEnabled() && (path === DEV_OVERRIDES_LIST_PATH || path.startsWith(`${DEV_OVERRIDE_PREFIX}/`));
}

export function pathForEventType(type: string): string | null {
  const path = pathByEvent(type);
  if (!path) return null;
  const derived = path.slice("/api/status/".length).replaceAll("/", "-");
  return derived === type ? path : null;
}

async function readOverride(path: string): Promise<Envelope | undefined> {
  return cacheGet<Envelope>(`${DEV_OVERRIDE_KEY}${path}`);
}

async function listOverrides(): Promise<string[]> {
  return (await cacheGet<string[]>(DEV_OVERRIDE_INDEX_KEY)) ?? [];
}

async function overridesSwitchedOn(): Promise<boolean> {
  return (await cacheGet<boolean>(DEV_OVERRIDE_ENABLED_KEY)) !== false;
}

async function writeOverride(path: string, envelope: Envelope): Promise<void> {
  const { env } = currentContext();
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  await hub.updateDevOverride(path, JSON.stringify(envelope));
}

async function clearOverride(path: string): Promise<void> {
  const { env } = currentContext();
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  await hub.updateDevOverride(path, null);
}

function statusHeaders(): HeadersInit {
  return { "Cache-Control": "no-store", "X-Fetched-At": new Date().toISOString() };
}

async function devOverrideResponse(request: Request, url: URL): Promise<Response> {
  if (url.pathname === DEV_OVERRIDES_LIST_PATH) {
    if (request.method === "PUT" || request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
      if (typeof body?.enabled !== "boolean") {
        return Response.json({ ok: false, error: "body 要是 {\"enabled\": true|false}" }, { status: 400 });
      }
      await cachePut(DEV_OVERRIDE_ENABLED_KEY, body.enabled, DEV_OVERRIDE_TTL_MS);
    } else if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    return Response.json(
      { ok: true, enabled: await overridesSwitchedOn(), paths: await listOverrides() },
      { headers: statusHeaders() },
    );
  }
  const target = url.pathname.slice(DEV_OVERRIDE_PREFIX.length);
  if (!target.startsWith("/api/")) {
    return Response.json({ ok: false, error: "路径要写成 /api/dev/override/api/status/…" }, { status: 400 });
  }
  if (request.method === "DELETE") {
    await clearOverride(target);
    return Response.json({ ok: true, cleared: target }, { headers: statusHeaders() });
  }
  if (request.method === "GET") {
    const override = (await overridesSwitchedOn()) ? await readOverride(target) : undefined;
    if (!override) return Response.json({ ok: false, error: "这条端点没有生效的注入" }, { status: 404 });
    return Response.json(override, { headers: statusHeaders() });
  }
  if (request.method !== "PUT" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ ok: false, error: "body 不是 JSON" }, { status: 400 });
  const envelope: Envelope = isEnvelope(body) ? body : { ok: true, data: body };
  await writeOverride(target, envelope);
  return Response.json({ ok: true, path: target }, { headers: statusHeaders() });
}

function loaderParams(request: Request): StatusLoaderParams {
  return {
    since: sinceParam(request),
    sinceDate: sinceDateParam(request),
    titleIds: titleIdsParam(request),
  };
}

async function serveStatus(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const key = viewKeyByPath(url.pathname);
  if (!key) return null;
  return statusResponse(await statusEnvelope(() => loadEndpoint(key, loaderParams(request))));
}

export async function publicResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const overrides = devOverridesEnabled();

  if (overrides && (url.pathname === DEV_OVERRIDES_LIST_PATH || url.pathname.startsWith(`${DEV_OVERRIDE_PREFIX}/`))) {
    return devOverrideResponse(request, url);
  }
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const upstream = upstreamBase();

  if (overrides && (await overridesSwitchedOn())) {
    const override = await readOverride(url.pathname);
    if (override) return Response.json(withServedAt(override), { headers: statusHeaders() });
  }
  const response = await serveStatus(request);
  if (!response) return new Response("Not found", { status: 404 });
  if (!upstream) return response;
  return overlayResponse(response, () => fetchUpstreamJson(upstream, `${url.pathname}${url.search}`));
}
