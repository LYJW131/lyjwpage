import { GET as lyricsGet } from "./routes/lyrics/route";
import { GET as motionArtworkGet } from "./routes/motion-artwork/route";
import { get as cacheGet, put as cachePut } from "@/lib/cache";
import { publicHomeSnapshot } from "@/lib/public-home";
import {
  sinceDateParam,
  sinceParam,
  statusEnvelope,
  statusResponse,
  titleIdsParam,
} from "@/lib/api";
import { loadEndpoint, type StatusLoaderParams } from "@/lib/status-loaders";
import {
  endpointViews,
  pathByEvent,
  viewKeyByPath,
} from "@/lib/status-views";
import {
  DEV_OVERRIDE_ENABLED_KEY,
  DEV_OVERRIDE_INDEX_KEY,
  DEV_OVERRIDE_KEY,
  DEV_OVERRIDE_PREFIX,
  DEV_OVERRIDES_LIST_PATH,
  DEV_OVERRIDE_TTL_MS,
} from "./dev-overrides";
import { currentContext } from "./runtime";

const extraRoutes: Record<string, (request: Request) => Promise<Response>> = {
  "/api/lyrics": lyricsGet,
  "/api/motion-artwork": motionArtworkGet,
};

/**
 * 本地开发的上游兜底。
 *
 * `wrangler dev` 起来的 Worker 是一座空库：没有上报器往它推，除了自己去
 * GitHub 取的那几张卡，别的全是降级态，新加一张卡时页面上没东西可对照。
 * 在 .dev.vars 里配 `UPSTREAM_API_URL=https://api.homepage.lyjw.llc` 后，
 * 生产为主、本地补缺：
 * - `/api/home`：生产快照里 ok:true 的字段直接用生产的；生产没有的字段
 *   （新加的）或生产也 ok:false 的，才用本地的；
 * - 其余 `/api/*`：生产回 ok:true 就用生产的，否则用本地的。
 * 不按「本地 ok:false 才兜底」来：空库上 desktop / nowWatching / timezone 这些
 * 会回 ok:true 的空态，那样一兜底就把生产正在放的东西盖没了。要测本地上报
 * 链路时把这个变量注释掉，本地就只看自己。只读，不碰上报。
 *
 * 生产版本不配这个变量。分支 Preview 的 [previews.vars] 会配，
 * 读取和本地一样；Preview 另外拒绝上报和导入。
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

function upstreamBase(): string | null {
  const value = process.env.UPSTREAM_API_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

type Envelope = { ok: boolean; [field: string]: unknown };

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && typeof (value as { ok?: unknown }).ok === "boolean";
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

/** 快照逐字段：上游有且不是 ok:false 的字段用上游的，其余保留本地 */
function overlaySnapshot<T extends object>(local: T, upstream: unknown): T {
  if (typeof upstream !== "object" || upstream === null) return local;
  const merged: Record<string, unknown> = { ...(local as Record<string, unknown>) };
  for (const [key, theirs] of Object.entries(upstream as Record<string, unknown>)) {
    const theirsUsable = theirs != null && !(isEnvelope(theirs) && !theirs.ok);
    if (theirsUsable) merged[key] = theirs;
  }
  return merged as T;
}

/** 单条端点：上游回 ok:true 就用上游的，头（Cache-Control、X-Fetched-At）沿用本地的 */
async function overlayResponse(local: Response, load: () => Promise<unknown>): Promise<Response> {
  const body: unknown = await local.clone().json().catch(() => null);
  if (!isEnvelope(body)) return local;
  const theirs = await load();
  if (!isEnvelope(theirs) || !theirs.ok) return local;
  return Response.json(theirs, { status: 200, headers: local.headers });
}

/**
 * 本地开发的假数据注入。
 *
 * 要看「正在播放」卡而此刻没在放、要看充电头满载而手边没插线 —— 生产兜底给不了
 * 这些。`.dev.vars` 里 `DEV_OVERRIDES=true` 后（生产不配）：
 * - `PUT /api/dev/override/api/status/watching/now`，body 是那条端点的信封
 *   （`{ok:true,data:…}`）或直接是 data，之后这条端点和 /api/home 里对应的字段
 *   都回这份，优先于本地和上游；
 * - `DELETE` 同一路径清掉；`GET /api/dev/overrides` 列出当前注入了哪些。
 * 存在本地 SQLite 里（7 天），wrangler 热重载不会丢。现成夹具在 dev-fixtures/，
 * 用 `pnpm dev:override` 推。
 */
const devOverridesEnabled = (): boolean => process.env.DEV_OVERRIDES?.trim() === "true";

/** Reject known-missing API paths before paying for a StateHub visibility barrier. */
export function isPublicApiPath(path: string): boolean {
  if (path === "/api/home" || Object.hasOwn(extraRoutes, path) || viewKeyByPath(path)) return true;
  return devOverridesEnabled() && (path === DEV_OVERRIDES_LIST_PATH || path.startsWith(`${DEV_OVERRIDE_PREFIX}/`));
}

/**
 * 推送事件名 → 端点路径，给上游推送中继替换 payload 用。
 *
 * 登记表里 `vibecoding-now` 的事件名不等于路径派生名（它只推部分字段，端点是
 * 整份 `/api/status/vibecoding`）：中继拿整份注入去盖部分推送会对不上，所以排除。
 */
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

/** 没拨过就是开 */
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
    // 单条注入现在生效的那份；总开关关着或没注入就 404。推送中继靠它判断要不要换 payload
    const override = (await overridesSwitchedOn()) ? await readOverride(target) : undefined;
    if (!override) return Response.json({ ok: false, error: "这条端点没有生效的注入" }, { status: 404 });
    return Response.json(override, { headers: statusHeaders() });
  }
  if (request.method !== "PUT" && request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) return Response.json({ ok: false, error: "body 不是 JSON" }, { status: 400 });
  // 给的是信封就原样存，给的是 data 就包成 ok:true
  const envelope: Envelope = isEnvelope(body) ? body : { ok: true, data: body };
  await writeOverride(target, envelope);
  return Response.json({ ok: true, path: target }, { headers: statusHeaders() });
}

async function applySnapshotOverrides<T extends object>(snapshot: T): Promise<T> {
  if (!(await overridesSwitchedOn())) return snapshot;
  const active = await listOverrides();
  if (!active.length) return snapshot;
  const merged: Record<string, unknown> = { ...(snapshot as Record<string, unknown>) };
  for (const [key, view] of endpointViews()) {
    if (!active.includes(view.path)) continue;
    const override = await readOverride(view.path);
    if (override) merged[key] = override;
  }
  return merged as T;
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
  const extra = extraRoutes[url.pathname];
  if (extra) return extra(request);

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

  if (url.pathname === "/api/home") {
    const local = await publicHomeSnapshot();
    const overlaid = upstream ? overlaySnapshot(local, await fetchUpstreamJson(upstream, "/api/home")) : local;
    const snapshot = overrides ? await applySnapshotOverrides(overlaid) : overlaid;
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  }

  if (overrides && (await overridesSwitchedOn())) {
    const override = await readOverride(url.pathname);
    if (override) return Response.json(override, { headers: statusHeaders() });
  }
  const response = await serveStatus(request);
  if (!response) return new Response("Not found", { status: 404 });
  if (!upstream) return response;
  return overlayResponse(response, () => fetchUpstreamJson(upstream, `${url.pathname}${url.search}`));
}
