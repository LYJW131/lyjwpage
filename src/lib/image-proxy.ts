import { IMAGE_OBJECT_KEY, IMAGE_PATH_PREFIX } from "@shared/asset-url";
import { BodyTooLargeError, readBoundedBytes } from "@shared/read-bounded-bytes";

export const IMAGE_PROXY_PATH = "/image";

export const IMAGE_WIDTHS = [
  32, 48, 56, 64, 88, 96, 128, 160, 184, 192, 240, 256, 320, 384, 512, 640, 750,
  828, 1080, 1200, 1920,
] as const;

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_UPSTREAM_TIMEOUT_MS = 8_000;
export const IMAGE_MAX_REDIRECTS = 3;
export const IMAGE_DEFAULT_QUALITY = 75;
export const IMAGE_DEFAULT_WIDTH = 1920;

export const IMAGE_FIT_VALUES = ["cover", "contain", "scale-down"] as const;
export type ImageFit = (typeof IMAGE_FIT_VALUES)[number];

export const EXACT_IMAGE_HOSTS = new Set([
  "avatars.githubusercontent.com",
  "psn-rsc.prod.dl.playstation.net",
]);

export const SUFFIX_IMAGE_HOSTS = ["blobstore.apple.com", "mzstatic.com"];

const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function allowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (EXACT_IMAGE_HOSTS.has(host)) return true;
  return SUFFIX_IMAGE_HOSTS.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function isIpLiteralHost(host: string): boolean {
  return IPV4_LITERAL.test(host) || host.startsWith("[") || host === "::1";
}

export function parseImageSource(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  if (isIpLiteralHost(host)) return null;
  if (!allowedImageHost(host)) return null;
  return url;
}

export function parseVariantWidth(raw: string | null): number | null {
  if (raw === null) return IMAGE_DEFAULT_WIDTH;
  const width = Number(raw);
  return (IMAGE_WIDTHS as readonly number[]).includes(width) ? width : null;
}

export function parseVariantQuality(raw: string | null): number | null {
  if (raw === null) return IMAGE_DEFAULT_QUALITY;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const quality = Number(raw);
  return quality >= 1 && quality <= 100 ? quality : null;
}

export function parseVariantFit(raw: string | null): ImageFit | null {
  if (raw === null) return "scale-down";
  return (IMAGE_FIT_VALUES as readonly string[]).includes(raw)
    ? (raw as ImageFit)
    : null;
}

export function variantShape(width: number, fit: ImageFit): ImageTransform {
  return fit === "scale-down" ? { width, fit } : { width, height: width, fit };
}

export function optimizerImagePath(src: string, width: number, quality: number): string {
  return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}

export function imageWidthBucket(width: number): number {
  return IMAGE_WIDTHS.find((candidate) => candidate >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
}

export function displayWidthFromSizes(sizes: string | undefined): number | undefined {
  const widths = [...(sizes ?? "").replace(/\([^)]*\)/g, "").matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  return widths.length ? Math.max(...widths) : undefined;
}

export function optimizerSrcSet(src: string, quality: number, displayWidth: number): string {
  const entries: string[] = [];
  let previous = 0;
  for (const density of [1, 2, 3]) {
    const width = imageWidthBucket(displayWidth * density);
    if (width === previous) continue;
    entries.push(`${optimizerImagePath(src, width, quality)} ${density}x`);
    previous = width;
  }
  return entries.join(", ");
}

export class ImagePolicyError extends Error {
  readonly kind: "source" | "redirects";
  constructor(kind: "source" | "redirects") {
    super(kind === "source" ? "Image source rejected" : "Too many image redirects");
    this.kind = kind;
  }
}

export class ImageUpstreamError extends Error {
  readonly status: number;
  readonly host: string | null;
  constructor(status: number, host: string | null = null) {
    super(`Image upstream HTTP ${status}`);
    this.status = status;
    this.host = host;
  }
}

// 只有确定原图不在的上游状态对外回 404：404 / 410，以及 Apple blobstore 预签名链接过期回的 403。别的源回 403 可能是 WAF 或限流，和超时等其余状态一样算网关故障回 502，5xx 会进 Workers Issues 发告警。
function isBlobstore(host: string | null): boolean {
  return host === "blobstore.apple.com" || !!host?.endsWith(".blobstore.apple.com");
}

export function imageUpstreamFailureStatus(error: ImageUpstreamError): 404 | 413 | 502 {
  if (error.status === 413) return 413;
  if (error.status === 404 || error.status === 410) return 404;
  return error.status === 403 && isBlobstore(error.host) ? 404 : 502;
}

export function imageSourceFromInternalPath(pathname: string): string | null {
  if (!pathname.startsWith(`${IMAGE_PATH_PREFIX}/`)) return null;
  const key = pathname.slice(IMAGE_PATH_PREFIX.length + 1);
  return IMAGE_OBJECT_KEY.test(key) ? key : null;
}

export async function fetchImageUpstream(
  source: URL,
  fetchImpl: typeof fetch = fetch,
  deadline = Date.now() + IMAGE_UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  let url = source;
  for (let hop = 0; hop <= IMAGE_MAX_REDIRECTS; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ImageUpstreamError(504);
    const response = await fetchImpl(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
      headers: { Accept: "image/*" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      const next = parseImageSource(new URL(location, url).href);
      if (!next) throw new ImagePolicyError("source");
      url = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUpstreamError(response.status, url.hostname);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > IMAGE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageUpstreamError(413);
    }
    return response;
  }
  throw new ImagePolicyError("redirects");
}

export async function readImageBytes(response: Response): Promise<Uint8Array> {
  try {
    return await readBoundedBytes(response.body, IMAGE_MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new ImageUpstreamError(413);
    throw error;
  }
}
