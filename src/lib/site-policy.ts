import { AI_HTTP_PATHS, MCP_PATH } from "@shared/ai-paths";
import { APPLE_MUSIC_HTTP_PATHS } from "@shared/apple-music-paths";
import { IMAGE_PATH_PREFIX } from "@shared/asset-url";
import { LIVE_SOCKET_PATH } from "@shared/live-heartbeat";
import { SENTRY_RELAY_PREFIX } from "@shared/sentry";
import { lagViewKeyByPath, STATUS_VIEWS, type LagViewKey } from "@shared/status-views";
import { APP_VERSION_PATH } from "@/lib/app-version";
import { IMAGE_PROXY_PATH } from "@/lib/image-proxy";
import { SITE_ASSETS_PREFIX } from "@/lib/site-assets";

export const HOME_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400";
export const HOME_CACHE_TAG = "home";

// 不带 stale-while-revalidate：首页在自己的 SWR 里后台重建时若再拿到过期快照，重建出的还是旧版面，要再等一整轮。
export const STATUS_CACHE_CONTROL = "public, max-age=600, stale-if-error=604200";

// 充电头 / 充电宝那一格亮不亮还看上报新不新（shared/freshness.ts#chargingFeedClockStale），
// 断档那一刻没有上报能触发失效（断档后恢复由 core 失效，见 workers/core/src/stores/telemetry.ts），快照只能靠短期限跟上。
export const CLOCKED_LAYOUT_STATUS_CACHE_CONTROL = "public, max-age=60, stale-if-error=604200";
const CLOCKED_LAYOUT_TAGS: ReadonlySet<string> = new Set([STATUS_VIEWS.charger.tag, STATUS_VIEWS.powerBank.tag]);

// 降级信封（ok:false 或端点未部署）只短缓存、不带 SWR / stale-if-error：一次暂时故障不能顶替上一份好快照撑满 7 天。
export const STATUS_DEGRADED_CACHE_CONTROL = "public, max-age=60";

export const VERSION_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const REMOTE_IMAGE_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400";

export const GENERATED_ASSET_CACHE_CONTROL = "public, max-age=86400";

export const STABLE_ASSET_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export const NO_STORE = "no-store";

export type GatewayClass =
  | { kind: "lag-status"; view: LagViewKey }
  | {
      kind:
        | "core"
        | "ai"
        | "collector"
        | "sentry-relay"
        | "image-proxy"
        | "image-object"
        | "site-asset"
        | "render"
        | "invalid";
    };

export type SiteAssetRoute = { asset: string; cacheControl: string };

export const SITE_ASSET_ROUTES: ReadonlyMap<string, SiteAssetRoute> = new Map([
  ["/icon", { asset: `${SITE_ASSETS_PREFIX}/icon.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/apple-icon", { asset: `${SITE_ASSETS_PREFIX}/apple-icon.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/opengraph-image", { asset: `${SITE_ASSETS_PREFIX}/opengraph.png`, cacheControl: GENERATED_ASSET_CACHE_CONTROL }],
  ["/pwa/icon-192.png", { asset: `${SITE_ASSETS_PREFIX}/icon-192.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/pwa/icon-512.png", { asset: `${SITE_ASSETS_PREFIX}/icon-512.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
]);

const IMAGE_OBJECT_PATH = new RegExp(`^${IMAGE_PATH_PREFIX}/([a-f0-9]{64}\\.(?:png|webp|jpe?g|mp3))$`);

export function imageObjectKeyFromPath(pathname: string): string | null {
  const match = IMAGE_OBJECT_PATH.exec(pathname);
  return match ? match[1] : null;
}

const CONDITIONAL_FORWARD_HEADERS = [
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
] as const;

export function imageObjectRequest(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  const headers = new Headers();
  for (const name of CONDITIONAL_FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(url, { method: request.method, headers });
}

export type ByteRange = { offset: number; length?: number } | { suffix: number };

export type ImageObjectPart = { offset: number; length: number };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

// 只认单段范围；多段或写坏的 Range 按 RFC 9110 忽略，回整份。
export function parseByteRange(header: string | null): ByteRange | null {
  const match = header ? SINGLE_BYTE_RANGE.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) return { suffix: Number(match[2]) };
  const offset = Number(match[1]);
  if (!match[2]) return { offset };
  const end = Number(match[2]);
  return end < offset ? null : { offset, length: end - offset + 1 };
}

export function imageObjectPart(range: ByteRange, size: number): ImageObjectPart | null {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return length > 0 ? { offset: size - length, length } : null;
  }
  if (range.offset >= size) return null;
  return { offset: range.offset, length: Math.min(range.length ?? size - range.offset, size - range.offset) };
}

export function imageObjectHeaders(
  object: {
    httpEtag: string;
    size: number;
    writeHttpMetadata(headers: Headers): void;
  },
  part: ImageObjectPart | null = null,
): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
  headers.set("Accept-Ranges", "bytes");
  if (part) {
    headers.set("Content-Range", `bytes ${part.offset}-${part.offset + part.length - 1}/${object.size}`);
    headers.set("Content-Length", String(part.length));
  } else {
    headers.set("Content-Length", String(object.size));
  }
  return headers;
}

export function classifyGatewayRequest(method: string, pathname: string): GatewayClass {
  if (AI_HTTP_PATHS.has(pathname) || pathname.startsWith(`${MCP_PATH}/`)) return { kind: "ai" };
  if (APPLE_MUSIC_HTTP_PATHS.has(pathname)) return { kind: "collector" };
  if (pathname === LIVE_SOCKET_PATH || (pathname.startsWith("/api/") && pathname !== APP_VERSION_PATH)) {
    const view = method === "GET" ? lagViewKeyByPath(pathname) : undefined;
    return view ? { kind: "lag-status", view } : { kind: "core" };
  }
  if (pathname === SENTRY_RELAY_PREFIX || pathname.startsWith(`${SENTRY_RELAY_PREFIX}/`)) {
    return { kind: method === "POST" ? "sentry-relay" : "invalid" };
  }
  if (method !== "GET" && method !== "HEAD") return { kind: "invalid" };
  if (pathname.endsWith(".data")) return { kind: "render" };
  if (pathname === IMAGE_PROXY_PATH) return { kind: "image-proxy" };
  if (pathname.startsWith(`${IMAGE_PATH_PREFIX}/`)) {
    return { kind: imageObjectKeyFromPath(pathname) ? "image-object" : "invalid" };
  }
  if (SITE_ASSET_ROUTES.has(pathname)) return { kind: "site-asset" };
  return { kind: "render" };
}

export type RenderClass = "home-document" | "home-data" | "other";

export function classifyRenderRequest(pathname: string): RenderClass {
  if (pathname === "/") return "home-document";
  if (pathname === "/_.data" || pathname === "/.data") return "home-data";
  return "other";
}

export function renderCacheHeaders(
  kind: RenderClass,
  status: number,
  contentType: string,
  existing: string | null,
  setCookie: boolean,
): Record<string, string> | null {
  if (status >= 400) return { "Cache-Control": NO_STORE };
  if (setCookie) return { "Cache-Control": NO_STORE };
  if (existing !== null && /private|no-store/i.test(existing)) return null;
  const cacheable =
    (kind === "home-document" && status === 200 && contentType.includes("text/html")) ||
    (kind === "home-data" && status === 200 && contentType.includes("text/x-script"));
  if (cacheable) {
    return { "Cache-Control": HOME_CACHE_CONTROL, "Cache-Tag": HOME_CACHE_TAG };
  }
  if (kind !== "other" || !existing) return { "Cache-Control": NO_STORE };
  return null;
}

export function isPublicStatusEnvelope(value: unknown): value is { ok: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.ok !== "boolean") return false;
  return row.ok ? "data" in row : typeof row.error === "string";
}

export function statusCacheTag(tag: string): string {
  return `page:${tag}`;
}

export function statusSnapshotHeaders(tag: string | undefined, ok: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": !ok
      ? STATUS_DEGRADED_CACHE_CONTROL
      : tag && CLOCKED_LAYOUT_TAGS.has(tag)
        ? CLOCKED_LAYOUT_STATUS_CACHE_CONTROL
        : STATUS_CACHE_CONTROL,
  };
  if (tag) headers["Cache-Tag"] = statusCacheTag(tag);
  return headers;
}
