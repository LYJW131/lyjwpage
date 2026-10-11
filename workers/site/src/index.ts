import { WorkerEntrypoint } from "cloudflare:workers";
import { RouterContextProvider, createRequestHandler } from "react-router";

import * as Sentry from "@sentry/cloudflare";

import type { SiteCacheRpc } from "@shared/site-cache";

import { FIRST_SCREEN_FETCH_TIMEOUT_MS, type FirstScreen } from "@/lib/first-screen";
import {
  IMAGE_MAX_BYTES,
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
  type ImageFit,
} from "@/lib/image-proxy";
import type { LyricsResult } from "@/lib/lyrics";
import { BodyTooLargeError, readBoundedBytes } from "@/lib/read-bounded-bytes";
import { relaySentryEnvelope } from "@/lib/sentry-tunnel";
import {
  HOME_CACHE_TAG,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  IMMUTABLE_ASSET_PREFIXES,
  NO_STORE,
  REMOTE_IMAGE_CACHE_CONTROL,
  SERVICE_WORKER_CACHE_CONTROL,
  CONDITIONAL_FORWARD_HEADERS,
  classifyGatewayRequest,
  classifyRenderRequest,
  filterStatusTags,
  imageObjectHeaders,
  imageObjectKeyFromPath,
  imageObjectRequest,
  isPublicStatusEnvelope,
  renderCacheHeaders,
  statusSnapshotHeaders,
} from "@/lib/site-policy";
import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";
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

class StatusSnapshotBase extends WorkerEntrypoint<Env> implements SiteCacheRpc {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const view =
      (request.method === "GET" || request.method === "HEAD") && !url.search
        ? Object.values(STATUS_VIEWS).find((entry) => entry.path === url.pathname)
        : undefined;
    if (!view) return errorResponse(404);

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
    if (upstream.status === 404) {
      return Response.json(
        { ok: false, error: "Status unavailable" },
        { headers: statusSnapshotHeaders(200, tag) },
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
    return Response.json(payload, {
      status: 200,
      headers: statusSnapshotHeaders(200, tag),
    });
  }

  async invalidate(tags: readonly string[]): Promise<void> {
    const valid = filterStatusTags(tags);
    if (!valid.length) return;
    const cache = this.ctx.cache;
    if (!cache) throw new Error("StatusSnapshot cache is not enabled");
    await cache.invalidate({ tags: valid.map((tag) => `page:${tag}`) });
  }
}

class ImageVariantsBase extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(404);
    const objectKey = imageObjectKeyFromPath(url.pathname);
    if (objectKey) return this.rawObject(objectKey, request);
    if (url.pathname !== "/image") return errorResponse(404);

    const source = url.searchParams.get("url");
    const width = parseVariantWidth(url.searchParams.get("w"));
    const quality = parseVariantQuality(url.searchParams.get("q"));
    const fit = parseVariantFit(url.searchParams.get("fit"));
    if (!source || width === null || quality === null || fit === null) {
      return errorResponse(404);
    }
    const internalKey = imageSourceFromInternalPath(source);

    try {
      const bytes = await this.sourceBytes(source);
      const output = await this.transform(bytes, width, fit, quality);
      const response = output.response();
      const headers = new Headers(response.headers);
      headers.set(
        "Cache-Control",
        internalKey ? IMMUTABLE_ASSET_CACHE_CONTROL : REMOTE_IMAGE_CACHE_CONTROL,
      );
      return new Response(response.body, { status: 200, headers });
    } catch (error) {
      if (error instanceof ImagePolicyError) return errorResponse(404);
      if (error instanceof BodyTooLargeError) return errorResponse(413, "Image upstream too large");
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
      const object = await this.env.IMAGE_OBJECTS.get(objectKey);
      if (!object) return errorResponse(404);
      return new Response(object.body, { headers: imageObjectHeaders(object) });
    }
    const origin = imageObjectFallbackOrigin(this.env);
    if (!origin) return errorResponse(404);
    const forward = new Headers();
    for (const name of CONDITIONAL_FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value) forward.set(name, value);
    }
    try {
      return await fetch(`${origin}/${objectKey}`, {
        method: request.method,
        headers: forward,
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return errorResponse(502, "Image origin failed");
    }
  }

  private async sourceBytes(source: string): Promise<Uint8Array> {
    const objectKey = imageSourceFromInternalPath(source);
    if (objectKey) {
      if (isProduction(this.env)) {
        const head = await this.env.IMAGE_OBJECTS.head(objectKey);
        if (!head) throw new ImageUpstreamError(404);
        if (head.size > IMAGE_MAX_BYTES) throw new ImageUpstreamError(413);
        const object = await this.env.IMAGE_OBJECTS.get(objectKey);
        if (!object) throw new ImageUpstreamError(404);
        return readBoundedBytes(object.body, IMAGE_MAX_BYTES);
      }
      const origin = imageObjectFallbackOrigin(this.env);
      if (!origin) throw new ImageUpstreamError(404);
      const response = await fetch(`${origin}/${objectKey}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ImageUpstreamError(response.status);
      }
      return readImageBytes(response);
    }
    const parsed = parseImageSource(source);
    if (!parsed) throw new ImagePolicyError("source");
    const upstream = await fetchImageUpstream(parsed);
    return readImageBytes(upstream);
  }

  private async transform(
    bytes: Uint8Array,
    width: number,
    fit: ImageFit,
    quality: number,
  ): Promise<ImageTransformationResult> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return this.env.IMAGES.input(stream)
      .transform(variantShape(width, fit))
      .output({ format: "image/webp", quality });
  }
}

class RenderedSiteBase extends WorkerEntrypoint<Env> implements SiteCacheRpc {
  async fetch(request: Request): Promise<Response> {
    const context = new RouterContextProvider();
    context.set(siteContext, this.services(new URL(request.url).origin));
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
    await this.ctx.exports.StatusSnapshot.invalidate(valid);
    const cache = this.ctx.cache;
    if (!cache) throw new Error("RenderedSite cache is not enabled");
    await cache.invalidate({ tags: [HOME_CACHE_TAG] });
  }

  private services(origin: string): SiteServices {
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
          const target = new URL("https://site.internal/image");
          target.searchParams.set("url", url);
          target.searchParams.set("w", String(px));
          target.searchParams.set("fit", fit);
          if (quality !== undefined) target.searchParams.set("q", String(quality));
          const response = await ctx.exports.ImageVariants.fetch(
            new Request(target, { headers: { Accept: "image/webp" } }),
          );
          if (!response.ok) return null;
          const bytes = new Uint8Array(await response.arrayBuffer());
          const type = response.headers.get("Content-Type") ?? "image/webp";
          return `data:${type};base64,${toBase64(bytes)}`;
        } catch {
          return null;
        }
      },
      asset: (path: string) => env.ASSETS.fetch(new Request(new URL(path, origin))),
    };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
        return ctx.exports.ImageVariants.fetch(
          imageObjectRequest(request, route.objectKey!),
        );
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
        if (IMMUTABLE_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
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
