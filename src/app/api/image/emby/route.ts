import { verifyImageRequest } from "@/lib/image-proxy";

// 上游可能是内网地址，必须在 Node runtime 里转发
export const runtime = "nodejs";

const TIMEOUT_MS = 10_000;

/**
 * URL 里带着 Emby 的 image tag，图片内容变了 tag 就变，
 * 所以这个地址天然是不可变的 —— 可以让 CDN 和浏览器长期缓存。
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const verified = verifyImageRequest(searchParams);

  if (!verified.ok) {
    return new Response(verified.reason, { status: 403 });
  }

  const base = (process.env.EMBY_URL ?? "").replace(/\/+$/, "");
  if (!base) return new Response("未配置 EMBY_URL", { status: 500 });

  const { id, kind, tag, height } = verified.params;
  const upstreamUrl =
    `${base}/emby/Items/${id}/Images/${kind}` +
    `?${new URLSearchParams({ tag, maxHeight: String(height) })}`;

  // 把浏览器的条件请求透传上去，命中就回 304，省一次图片传输
  const ifNoneMatch = request.headers.get("if-none-match");

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: ifNoneMatch ? { "If-None-Match": ifNoneMatch } : undefined,
      // 必须是 no-cache 而不是 no-store：undici 在 no-store（和默认）模式下
      // 会丢掉调用方自己设的 If-None-Match，导致 304 永远命中不了。
      // no-cache 表示「每次都回源校验」，正是这里要的语义。
      cache: ifNoneMatch ? "no-cache" : "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (upstream.status === 304) {
      return new Response(null, {
        status: 304,
        headers: { "Cache-Control": CACHE_CONTROL },
      });
    }

    if (!upstream.ok || !upstream.body) {
      return new Response("上游图片获取失败", { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": CACHE_CONTROL,
    });
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    // 直接把流转出去，不在内存里缓冲整张图
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[image/emby]", message);
    return new Response("上游图片获取失败", { status: 502 });
  }
}
