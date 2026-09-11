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
 * 在 .dev.vars 里配 `UPSTREAM_API_URL=https://api.homepage.lyjw.llc` 后：
 * - `/api/home`：本地答不上来的字段（`ok:false` 或空）逐个换成生产快照里的；
 * - 其余 `/api/*`：本地回 `ok:false` 的信封就转发生产的同一路径。
 * 新端点、新字段天然只有本地有，旧的照常有数据看。只读，不碰上报。
 *
 * 生产的 wrangler.toml 不配这个变量，线上一行都不会走到这里。
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

function upstreamBase(): string | null {
  const value = process.env.UPSTREAM_API_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

type Envelope = { ok: boolean };

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

/** 快照逐字段兜底：本地为空或 ok:false 的字段，用上游里有的换掉 */
function overlaySnapshot<T extends object>(local: T, upstream: unknown): T {
  if (typeof upstream !== "object" || upstream === null) return local;
  const merged: Record<string, unknown> = { ...(local as Record<string, unknown>) };
  for (const [key, theirs] of Object.entries(upstream as Record<string, unknown>)) {
    const mine = merged[key];
    const mineMissing = mine == null || (isEnvelope(mine) && !mine.ok);
    const theirsUsable = theirs != null && !(isEnvelope(theirs) && !theirs.ok);
    if (mineMissing && theirsUsable) merged[key] = theirs;
  }
  return merged as T;
}

/** 单条端点兜底：本地信封 ok:false 才去问上游，头（Cache-Control、X-Fetched-At）沿用本地的 */
async function overlayResponse(local: Response, load: () => Promise<unknown>): Promise<Response> {
  const body: unknown = await local.clone().json().catch(() => null);
  if (!isEnvelope(body) || body.ok) return local;
  const theirs = await load();
  if (!isEnvelope(theirs) || !theirs.ok) return local;
  return Response.json(theirs, { status: 200, headers: local.headers });
}

export async function publicResponse(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  const upstream = upstreamBase();

  if (url.pathname === "/api/home") {
    const local = await publicHomeSnapshot();
    const snapshot = upstream ? overlaySnapshot(local, await fetchUpstreamJson(upstream, "/api/home")) : local;
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  }

  const handler = routes[url.pathname];
  if (!handler) return new Response("Not found", { status: 404 });
  const response = await handler(request);
  if (!upstream) return response;
  return overlayResponse(response, () => fetchUpstreamJson(upstream, `${url.pathname}${url.search}`));
}
