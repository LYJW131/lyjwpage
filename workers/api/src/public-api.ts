import { GET as route0 } from "./routes/status/listening/route";
import { GET as route1 } from "./routes/status/watching/route";
import { GET as route2 } from "./routes/status/charger/route";
import { GET as route3 } from "./routes/status/activity/route";
import { GET as route4 } from "./routes/status/powerbank/route";
import { GET as route5 } from "./routes/status/trophies/route";
import { GET as route6 } from "./routes/status/desktop/route";
import { GET as route7 } from "./routes/status/server/route";
import { GET as route8 } from "./routes/status/playing/route";
import { GET as route9 } from "./routes/status/github-chart/route";
import { GET as route10 } from "./routes/status/vibecoding/route";
import { GET as route11 } from "./routes/status/vibecoding/year/route";
import { GET as route12 } from "./routes/status/playing/now/route";
import { GET as route13 } from "./routes/status/watching/now/route";
import { GET as route14 } from "./routes/status/listening/now/route";
import { GET as route15 } from "./routes/lyrics/route";
import { GET as route16 } from "./routes/motion-artwork/route";
import { GET as route17 } from "./routes/status/github-repo/route";
import { get as cacheGet, put as cachePut, remove as cacheRemove } from "@/lib/cache";
import { publicHomeSnapshot } from "@/lib/public-home";

const routes: Record<string, (request: Request) => Promise<Response>> = {
  "/api/status/listening": route0,
  "/api/status/watching": route1,
  "/api/status/charger": route2,
  "/api/status/activity": route3,
  "/api/status/powerbank": route4,
  "/api/status/trophies": route5,
  "/api/status/desktop": route6,
  "/api/status/server": route7,
  "/api/status/playing": route8,
  "/api/status/github-chart": route9,
  "/api/status/vibecoding": route10,
  "/api/status/vibecoding/year": route11,
  "/api/status/playing/now": route12,
  "/api/status/watching/now": route13,
  "/api/status/listening/now": route14,
  "/api/lyrics": route15,
  "/api/motion-artwork": route16,
  "/api/status/github-repo": route17,
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
 * 生产的 wrangler.toml 不配这个变量，线上一行都不会走到这里。
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
const DEV_OVERRIDE_PREFIX = "/api/dev/override";
const DEV_OVERRIDES_LIST_PATH = "/api/dev/overrides";
const DEV_OVERRIDE_KEY = "dev-override:";
const DEV_OVERRIDE_INDEX_KEY = "dev-override-index";
/** 总开关：关着时夹具都还在，只是不生效。页面右下角那粒「Fake data」胶囊拨的就是它 */
const DEV_OVERRIDE_ENABLED_KEY = "dev-override-enabled";
const DEV_OVERRIDE_TTL_MS = 7 * 86_400_000;

/** /api/home 的字段 ↔ 单条端点，注入按端点路径记，快照按这张表取 */
const SNAPSHOT_PATHS: Record<string, string> = {
  desktop: "/api/status/desktop",
  activity: "/api/status/activity",
  server: "/api/status/server",
  charger: "/api/status/charger",
  powerBank: "/api/status/powerbank",
  listening: "/api/status/listening",
  nowListening: "/api/status/listening/now",
  vibeCoding: "/api/status/vibecoding",
  vibeCodingYear: "/api/status/vibecoding/year",
  watching: "/api/status/watching",
  nowWatching: "/api/status/watching/now",
  playing: "/api/status/playing",
  playingNow: "/api/status/playing/now",
  trophies: "/api/status/trophies",
  githubChart: "/api/status/github-chart",
  githubRepo: "/api/status/github-repo",
};

const devOverridesEnabled = (): boolean => process.env.DEV_OVERRIDES?.trim() === "true";

/**
 * 推送事件名 ↔ 端点路径：事件名就是路径去掉 /api/status/ 再把 `/` 换成 `-`
 * （watching-now ↔ /api/status/watching/now）。反向不能直接算（github-chart 里
 * 本来就有连字符），按已知端点表反查。给上游推送中继用：事件落在有注入的端点上
 * 时要换 payload。
 */
const PATH_BY_EVENT_TYPE = new Map(
  Object.values(SNAPSHOT_PATHS).map((path) => [path.slice("/api/status/".length).replaceAll("/", "-"), path]),
);

export function pathForEventType(type: string): string | null {
  return PATH_BY_EVENT_TYPE.get(type) ?? null;
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
  await cachePut(`${DEV_OVERRIDE_KEY}${path}`, envelope, DEV_OVERRIDE_TTL_MS);
  const index = await listOverrides();
  if (!index.includes(path)) await cachePut(DEV_OVERRIDE_INDEX_KEY, [...index, path], DEV_OVERRIDE_TTL_MS);
}

async function clearOverride(path: string): Promise<void> {
  await cacheRemove(`${DEV_OVERRIDE_KEY}${path}`);
  const index = await listOverrides();
  await cachePut(DEV_OVERRIDE_INDEX_KEY, index.filter((item) => item !== path), DEV_OVERRIDE_TTL_MS);
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
  for (const [key, path] of Object.entries(SNAPSHOT_PATHS)) {
    if (!active.includes(path)) continue;
    const override = await readOverride(path);
    if (override) merged[key] = override;
  }
  return merged as T;
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

  const handler = routes[url.pathname];
  if (!handler) return new Response("Not found", { status: 404 });
  if (overrides && (await overridesSwitchedOn())) {
    const override = await readOverride(url.pathname);
    if (override) return Response.json(override, { headers: statusHeaders() });
  }
  const response = await handler(request);
  if (!upstream) return response;
  return overlayResponse(response, () => fetchUpstreamJson(upstream, `${url.pathname}${url.search}`));
}
