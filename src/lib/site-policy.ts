import { MCP_PATH } from "@shared/mcp";

import { IMAGE_PATH_PREFIX } from "@/lib/asset-url";
import { IMAGE_PROXY_PATH } from "@/lib/image-proxy";
import { SENTRY_RELAY_PREFIX } from "@/lib/sentry";
import { SITE_ASSETS_PREFIX } from "@/lib/site-assets";

export const HOME_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400";
export const HOME_CACHE_TAG = "home";

export const STATUS_CACHE_CONTROL =
  "public, max-age=600, stale-while-revalidate=604200, stale-if-error=604200";

export const VERSION_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export const SERVICE_WORKER_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

export const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const REMOTE_IMAGE_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=86400, stale-if-error=86400";

export const GENERATED_ASSET_CACHE_CONTROL = "public, max-age=86400";

export const STABLE_ASSET_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export const NO_STORE = "no-store";

export type GatewayKind =
  | "mcp"
  | "sentry-relay"
  | "image-proxy"
  | "image-object"
  | "site-asset"
  | "explainer-index"
  | "service-worker"
  | "asset"
  | "render"
  | "invalid";

export type GatewayClass = {
  kind: GatewayKind;
};

export type SiteAssetRoute = { asset: string; cacheControl: string };

export const SITE_ASSET_ROUTES: ReadonlyMap<string, SiteAssetRoute> = new Map([
  ["/icon", { asset: `${SITE_ASSETS_PREFIX}/icon.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/apple-icon", { asset: `${SITE_ASSETS_PREFIX}/apple-icon.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/opengraph-image", { asset: `${SITE_ASSETS_PREFIX}/opengraph.png`, cacheControl: GENERATED_ASSET_CACHE_CONTROL }],
  ["/pwa/icon-192.png", { asset: `${SITE_ASSETS_PREFIX}/icon-192.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
  ["/pwa/icon-512.png", { asset: `${SITE_ASSETS_PREFIX}/icon-512.png`, cacheControl: STABLE_ASSET_CACHE_CONTROL }],
]);

export const IMMUTABLE_EXPLAINER_PREFIX = "/explainer/a/";

const ASSET_PREFIXES = [
  "/explainer/",
  "/site-assets/",
  "/assets/",
  "/trophies/",
  "/fonts/",
];

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

export function imageObjectHeaders(object: {
  httpEtag: string;
  size: number;
  writeHttpMetadata(headers: Headers): void;
}): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
  headers.set("Accept-Ranges", "bytes");
  return headers;
}

function looksStatic(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  if (ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return last.includes(".");
}

export function classifyGatewayRequest(method: string, pathname: string): GatewayClass {
  if (pathname === MCP_PATH || pathname.startsWith(`${MCP_PATH}/`)) return { kind: "mcp" };
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
  if (pathname === "/explainer") return { kind: "explainer-index" };
  if (pathname === "/sw.js") return { kind: "service-worker" };
  if (looksStatic(pathname)) return { kind: "asset" };
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

export function isPublicStatusEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.ok !== "boolean") return false;
  return row.ok ? "data" in row : typeof row.error === "string";
}

export function statusCacheTag(tag: string): string {
  return `page:${tag}`;
}

export function statusSnapshotHeaders(tag: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": STATUS_CACHE_CONTROL };
  if (tag) headers["Cache-Tag"] = statusCacheTag(tag);
  return headers;
}
