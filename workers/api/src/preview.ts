/**
 * 分支 Worker Preview。wrangler.toml 的 [previews.vars] 才把 PREVIEW_WORKER 设成 true。
 * 生产版本不设它，下面这些分支在线上走不到。
 */

const PROXY_PATHS = new Set([
  "/api/musickit/token",
  "/api/lyrics",
  "/api/motion-artwork",
]);

const PROXY_TIMEOUT_MS = 10_000;
const PROXY_MAX_BYTES = 1_000_000;

export function previewWorkerEnabled(): boolean {
  return process.env.PREVIEW_WORKER?.trim() === "true";
}

/**
 * 这三条浏览器会直接打到后端，响应又不是 `{ok}` 信封，上游兜底不会替换。
 * 影子库是空的，也没有 Apple 私钥，原样转给生产。
 */
export function isPreviewProxyPath(pathname: string): boolean {
  return PROXY_PATHS.has(pathname);
}

type PreviewState = {
  ready: () => boolean | Promise<boolean>;
  finishImport: () => Promise<void>;
};

/** 空库第一次公开读取前标成已初始化，公开路径才不会一直 503。不导入任何条目。 */
export async function ensurePreviewState(hub: PreviewState): Promise<void> {
  if (!previewWorkerEnabled()) return;
  if (await hub.ready()) return;
  await hub.finishImport();
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("upstream body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** 只转发 GET 的路径和来源，不跟随重定向，避免变成通向生产的开放代理。 */
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

  let body: Uint8Array;
  try {
    body = await readBounded(upstream, PROXY_MAX_BYTES);
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
