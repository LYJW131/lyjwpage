import { APPLE_MUSIC_HTTP_PATHS } from "@shared/apple-music-paths";
import { readBoundedBytes } from "@shared/read-bounded-bytes";

const PROXY_TIMEOUT_MS = 10_000;
const PROXY_MAX_BYTES = 1_000_000;

export function previewWorkerEnabled(): boolean {
  return process.env.PREVIEW_WORKER?.trim() === "true";
}

export function isPreviewProxyPath(pathname: string): boolean {
  return APPLE_MUSIC_HTTP_PATHS.has(pathname);
}

export async function fetchPreviewUpstream(request: Request): Promise<Response> {
  const base = process.env.UPSTREAM_API_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    return Response.json({ ok: false, error: "预览 Worker 未配置上游" }, { status: 503 });
  }
  const url = new URL(request.url);
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Origin", origin);
  const accept = request.headers.get("Accept");
  if (accept) headers.set("Accept", accept);

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${url.pathname}${url.search}`, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn("[preview]", error instanceof Error ? error.message : String(error));
    return Response.json({ ok: false, error: "上游暂时不可用" }, { status: 502 });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    return Response.json({ ok: false, error: "上游返回了重定向" }, { status: 502 });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readBoundedBytes(upstream.body, PROXY_MAX_BYTES);
  } catch (error) {
    console.warn("[preview]", error instanceof Error ? error.message : String(error));
    return Response.json({ ok: false, error: "上游响应过大" }, { status: 502 });
  }

  const responseHeaders = new Headers();
  const type = upstream.headers.get("Content-Type");
  if (type) responseHeaders.set("Content-Type", type);
  const cache = upstream.headers.get("Cache-Control");
  if (cache) responseHeaders.set("Cache-Control", cache);
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
