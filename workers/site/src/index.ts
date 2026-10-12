import { WorkerEntrypoint } from "cloudflare:workers";
import { RouterContextProvider, createRequestHandler } from "react-router";

import * as Sentry from "@sentry/cloudflare";

import type { SiteCacheRpc } from "@shared/site-cache";

import {
  FIRST_SCREEN_FETCH_TIMEOUT_MS,
  FIRST_SCREEN_UNAVAILABLE,
  type FirstScreen,
} from "@/lib/first-screen";
import {
  IMAGE_MAX_BYTES,
  IMAGE_PROXY_PATH,
  IMAGE_UPSTREAM_TIMEOUT_MS,
  ImagePolicyError,
  ImageUpstreamError,
  fetchImageUpstream,
  imageSourceFromInternalPath,
  parseImageSource,
  parseVariantFit,
  parseVariantQuality,
  parseVariantWidth,
  readImageBytes,
  variantShape,
} from "@/lib/image-proxy";
import type { LyricsResult } from "@shared/lyrics-ttml";
import { relaySentryEnvelope } from "@/lib/sentry-tunnel";
import {
  HOME_CACHE_TAG,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  IMMUTABLE_EXPLAINER_PREFIX,
  NO_STORE,
  REMOTE_IMAGE_CACHE_CONTROL,
  SERVICE_WORKER_CACHE_CONTROL,
  SITE_ASSET_ROUTES,
  classifyGatewayRequest,
  classifyRenderRequest,
  imageObjectHeaders,
  imageObjectKeyFromPath,
  imageObjectPart,
  parseByteRange,
  imageObjectRequest,
  isPublicStatusEnvelope,
  renderCacheHeaders,
  statusCacheTag,
  statusSnapshotHeaders,
} from "@/lib/site-policy";
import {
  STATUS_VIEWS,
  filterStatusTags,
  viewKeyByPath,
  type StatusViewKey,
} from "@shared/status-views";
import { siteContext, type SiteServices } from "@/server/site-context";

import { sentryOptions } from "./sentry";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const DEFAULT_BACKEND_ORIGIN = "https://api.homepage.lyjw.llc";

function isProduction(env: Env): boolean {
  return env.SITE_ENV === "production";
}

function backendOrigin(env: Env): string {
  const configured = isProduction(env)
    ? env.PUBLIC_BACKEND_URL
    : process.env.PUBLIC_BACKEND_URL || env.PUBLIC_BACKEND_URL;
  return (configured?.trim() || DEFAULT_BACKEND_ORIGIN).replace(/\/+$/, "");
}

function imageObjectFallbackOrigin(env: Env): string | null {
  const declared = "R2_PUBLIC_BASE_URL" in env && typeof env.R2_PUBLIC_BASE_URL === "string" ? env.R2_PUBLIC_BASE_URL : undefined;
  const base = declared || process.env.R2_PUBLIC_BASE_URL;
  return base ? base.replace(/\/+$/, "") : null;
}

function errorResponse(status: number, message = "Not Found"): Response {
  return new Response(message, {
    status,
    headers: { "Cache-Control": NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// 用 purge 而非 invalidate：响应不带 ETag / Last-Modified 且有 stale-while-revalidate，软失效会先回旧正文，首页后台重建时读到的也还是旧快照。
async function purgeTags(cache: CacheContext | undefined, owner: string, tags: string[]): Promise<void> {
  if (!cache) throw new Error(`${owner} cache is not enabled`);
  const result = await cache.purge({ tags });
  if (!result.success) {
    const reason = result.errors.map((error) => `${error.code} ${error.message}`).join("; ");
    throw new Error(`${owner} purge failed: ${reason || "unknown"}`);
  }
}

class StatusSnapshotBase extends WorkerEntrypoint<Env> implements SiteCacheRpc {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key =
      (request.method === "GET" || request.method === "HEAD") && !url.search
        ? viewKeyByPath(url.pathname)
        : undefined;
    if (!key) return errorResponse(404);
    const view = STATUS_VIEWS[key];

    let upstream: Response;
    try {
      upstream = isProduction(this.env)
        ? await this.env.PUBLIC_STATUS.readStatus(url.pathname)
        : await fetch(`${backendOrigin(this.env)}${url.pathname}`, {
            signal: AbortSignal.timeout(FIRST_SCREEN_FETCH_TIMEOUT_MS),
          });
    } catch {
      return errorResponse(503, "Status upstream failed");
    }

    const tag = "tag" in view ? view.tag : undefined;
    // 上游故障必须报错以保留上一份首屏缓存；未部署端点的 404 才降级为空卡片。
    if (upstream.status === 404) {
      return Response.json(
        { ok: false, error: FIRST_SCREEN_UNAVAILABLE },
        { headers: statusSnapshotHeaders(tag, false) },
      );
    }
    if (!upstream.ok) return errorResponse(503, "Status upstream failed");

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      return errorResponse(503, "Status payload invalid");
    }
    if (!isPublicStatusEnvelope(payload)) {
      return errorResponse(503, "Status payload invalid");
    }
    return Response.json(payload, { headers: statusSnapshotHeaders(tag, payload.ok) });
  }

  async invalidate(tags: readonly string[]): Promise<void> {
    const valid = filterStatusTags(tags);
    if (!valid.length) return;
    await purgeTags(this.ctx.cache, "StatusSnapshot", valid.map(statusCacheTag));
  }
}

class ImageVariantsBase extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(404);
    const objectKey = imageObjectKeyFromPath(url.pathname);
    if (objectKey) return this.rawObject(objectKey, request);
    if (url.pathname !== IMAGE_PROXY_PATH) return errorResponse(404);

    const source = url.searchParams.get("url");
    const width = parseVariantWidth(url.searchParams.get("w"));
    const quality = parseVariantQuality(url.searchParams.get("q"));
    const fit = parseVariantFit(url.searchParams.get("fit"));
    if (!source || width === null || quality === null || fit === null) {
      return errorResponse(404);
    }
    const internalKey = imageSourceFromInternalPath(source);

    try {
      const input = internalKey
        ? await this.objectStream(internalKey)
        : await this.remoteStream(source);
      const output = await this.env.IMAGES.input(input)
        .transform(variantShape(width, fit))
        .output({ format: "image/webp", quality });
      const response = output.response();
      const headers = new Headers(response.headers);
      // 对象键是内容哈希，字节不变，变体可按内容寻址永久缓存。
      headers.set(
        "Cache-Control",
        internalKey ? IMMUTABLE_ASSET_CACHE_CONTROL : REMOTE_IMAGE_CACHE_CONTROL,
      );
      return new Response(response.body, { status: 200, headers });
    } catch (error) {
      if (error instanceof ImagePolicyError) return errorResponse(404);
      if (error instanceof ImageUpstreamError) return errorResponse(error.status === 413 ? 413 : 502, "Image upstream failed");
      console.error("[image]", error instanceof Error ? error.message : error);
      return errorResponse(502, "Image transform failed");
    }
  }

  private async rawObject(objectKey: string, request: Request): Promise<Response> {
    if (isProduction(this.env)) {
      if (request.method === "HEAD") {
        const head = await this.env.IMAGE_OBJECTS.head(objectKey);
        if (!head) return errorResponse(404);
        return new Response(null, { headers: imageObjectHeaders(head) });
      }
      // If-Range 的校验 R2 不做，按 RFC 9110 忽略 Range 回整份。
      const range = request.headers.has("if-range") ? null : parseByteRange(request.headers.get("range"));
      const head = range ? await this.env.IMAGE_OBJECTS.head(objectKey) : null;
      if (range && !head) return errorResponse(404);
      const part = head && range ? imageObjectPart(range, head.size) : null;
      if (head && !part) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${head.size}`, "Cache-Control": NO_STORE },
        });
      }
      const object = await this.env.IMAGE_OBJECTS.get(objectKey, {
        range: part ?? undefined,
        onlyIf: request.headers,
      });
      if (!object) return errorResponse(404);
      if (!("body" in object)) {
        const headers = imageObjectHeaders(object);
        headers.delete("Content-Length");
        return new Response(null, { status: 304, headers });
      }
      return new Response(object.body, { status: part ? 206 : 200, headers: imageObjectHeaders(object, part) });
    }
    try {
      return await this.fetchObjectOrigin(objectKey, {
        method: request.method,
        headers: request.headers,
      });
    } catch {
      return errorResponse(502, "Image origin failed");
    }
  }

  private async objectStream(objectKey: string): Promise<ReadableStream<Uint8Array>> {
    if (isProduction(this.env)) {
      const object = await this.env.IMAGE_OBJECTS.get(objectKey);
      if (!object) throw new ImageUpstreamError(404);
      if (object.size > IMAGE_MAX_BYTES) {
        await object.body.cancel();
        throw new ImageUpstreamError(413);
      }
      return object.body;
    }
    const response = await this.fetchObjectOrigin(objectKey);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUpstreamError(response.status);
    }
    return bytesStream(await readImageBytes(response));
  }

  private async remoteStream(source: string): Promise<ReadableStream<Uint8Array>> {
    const parsed = parseImageSource(source);
    if (!parsed) throw new ImagePolicyError("source");
    return bytesStream(await readImageBytes(await fetchImageUpstream(parsed)));
  }

  private async fetchObjectOrigin(objectKey: string, init: RequestInit = {}): Promise<Response> {
    const origin = imageObjectFallbackOrigin(this.env);
    if (!origin) return errorResponse(404);
    return fetch(`${origin}/${objectKey}`, {
      ...init,
      signal: AbortSignal.timeout(IMAGE_UPSTREAM_TIMEOUT_MS),
    });
  }
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

class RenderedSiteBase extends WorkerEntrypoint<Env> implements SiteCacheRpc {
  async fetch(request: Request): Promise<Response> {
    const context = new RouterContextProvider();
    context.set(siteContext, this.services());
    const response = await requestHandler(request, context);
    const { pathname } = new URL(request.url);
    const policy = renderCacheHeaders(
      classifyRenderRequest(pathname),
      response.status,
      response.headers.get("Content-Type") ?? "",
      response.headers.get("Cache-Control"),
      response.headers.has("Set-Cookie"),
    );
    if (!policy) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(policy)) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  async invalidate(tags: readonly string[]): Promise<void> {
    const valid = filterStatusTags(tags);
    if (!valid.length) return;
    // 先清快照再清首页：反过来的话，夹在中间的请求会用旧快照重建首页并再缓存一轮。
    await this.ctx.exports.StatusSnapshot.invalidate(valid);
    await purgeTags(this.ctx.cache, "RenderedSite", [HOME_CACHE_TAG]);
  }

  private services(): SiteServices {
    const env = this.env;
    const ctx = this.ctx;
    return {
      status: async <K extends StatusViewKey>(key: K): Promise<FirstScreen<K>> => {
        const view = STATUS_VIEWS[key];
        const response = await ctx.exports.StatusSnapshot.fetch(
          new Request(`https://site.internal${view.path}`),
        );
        if (!response.ok) throw new Error(`First screen ${view.path}: ${response.status}`);
        return (await response.json()) as FirstScreen<K>;
      },
      lyrics: async (songId: string): Promise<LyricsResult | null> => {
        try {
          const response = await fetch(
            `${backendOrigin(env)}/api/lyrics?song=${encodeURIComponent(songId)}`,
            { signal: AbortSignal.timeout(FIRST_SCREEN_FETCH_TIMEOUT_MS) },
          );
          if (!response.ok) return null;
          return (await response.json()) as LyricsResult;
        } catch {
          return null;
        }
      },
      image: async (url, px, fit, quality) => {
        try {
          const target = new URL(IMAGE_PROXY_PATH, "https://site.internal");
          target.searchParams.set("url", url);
          target.searchParams.set("w", String(px));
          target.searchParams.set("fit", fit);
          if (quality !== undefined) target.searchParams.set("q", String(quality));
          const response = await ctx.exports.ImageVariants.fetch(
            new Request(target, { headers: { Accept: "image/webp" } }),
          );
          if (!response.ok) return null;
          const base64 = Buffer.from(await response.arrayBuffer()).toString("base64");
          const type = response.headers.get("Content-Type") ?? "image/webp";
          return `data:${type};base64,${base64}`;
        } catch {
          return null;
        }
      },
    };
  }
}

async function relaySentry(request: Request, env: Env): Promise<Response> {
  const result = await relaySentryEnvelope(request, env.SENTRY_DSN);
  if ("reject" in result) return errorResponse(result.reject);
  const headers = new Headers({ "Cache-Control": NO_STORE });
  const type = result.response.headers.get("Content-Type");
  if (type) headers.set("Content-Type", type);
  return new Response(result.response.body, { status: result.response.status, headers });
}

const siteWorker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const route = classifyGatewayRequest(request.method, url.pathname);
    switch (route.kind) {
      case "mcp":
        return Response.redirect(`${backendOrigin(env)}${url.pathname}${url.search}`, 307);
      case "sentry-relay":
        return relaySentry(request, env);
      case "image-proxy":
        return ctx.exports.ImageVariants.fetch(request);
      case "image-object":
        return ctx.exports.ImageVariants.fetch(imageObjectRequest(request));
      case "site-asset": {
        const { asset, cacheControl } = SITE_ASSET_ROUTES.get(url.pathname)!;
        const response = await env.ASSETS.fetch(new Request(new URL(asset, url), request));
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", response.ok ? cacheControl : NO_STORE);
        return new Response(response.body, { status: response.status, headers });
      }
      case "explainer-index": {
        const response = await env.ASSETS.fetch(
          new Request(new URL("/explainer/index.html", url), request),
        );
        if (response.status === 404) return ctx.exports.RenderedSite.fetch(request);
        return response;
      }
      case "service-worker": {
        const response = await env.ASSETS.fetch(request);
        const headers = new Headers(response.headers);
        headers.set("Content-Type", "application/javascript; charset=utf-8");
        headers.set("Cache-Control", SERVICE_WORKER_CACHE_CONTROL);
        return new Response(response.body, { status: response.status, headers });
      }
      case "asset": {
        const response = await env.ASSETS.fetch(request);
        if (response.status === 404) return ctx.exports.RenderedSite.fetch(request);
        if (url.pathname.startsWith(IMMUTABLE_EXPLAINER_PREFIX)) {
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", IMMUTABLE_ASSET_CACHE_CONTROL);
          return new Response(response.body, { status: response.status, headers });
        }
        return response;
      }
      case "render":
        return ctx.exports.RenderedSite.fetch(request);
      default:
        return errorResponse(404);
    }
  },
};

export const StatusSnapshot = Sentry.withSentry(sentryOptions, StatusSnapshotBase);
export const ImageVariants = Sentry.withSentry(sentryOptions, ImageVariantsBase);
export const RenderedSite = Sentry.withSentry(sentryOptions, RenderedSiteBase);
export default Sentry.withSentry(sentryOptions, siteWorker);
