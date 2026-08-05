import { getCachedImage } from "@/lib/image-cache";
import { decodeImageToken } from "@/lib/image-proxy";

// 上游可能是内网地址，必须在 Node runtime 里转发
export const runtime = "nodejs";

const TIMEOUT_MS = 10_000;

/**
 * token 里包含 Emby 的 image tag，图片内容变了 tag 就变，
 * 所以这个地址天然是不可变的 —— 可以让 CDN 和浏览器长期缓存。
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function GET(request: Request, ctx: RouteContext<"/api/image/emby/[token]">) {
  const { token } = await ctx.params;
  const decoded = decodeImageToken(token);

  if (!decoded.ok) {
    return new Response(decoded.reason, { status: 403 });
  }

  const base = (process.env.EMBY_URL ?? "").replace(/\/+$/, "");
  if (!base) return new Response("未配置 EMBY_URL", { status: 500 });

  const { id, kind, tag, height } = decoded.params;
  const upstreamUrl =
    `${base}/emby/Items/${id}/Images/${kind}` +
    `?${new URLSearchParams({ tag, maxHeight: String(height) })}`;

  let entry;
  try {
    // token 与 (id,kind,tag,height) 一一对应，直接拿它当缓存 key。
    // 同一个 key 并发进来只回源一次，前端打多快都不会等比传导到 Emby。
    entry = await getCachedImage(token, async () => {
      const upstream = await fetch(upstreamUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!upstream.ok) throw new Error(`上游返回 ${upstream.status}`);

      return {
        body: Buffer.from(await upstream.arrayBuffer()),
        contentType: upstream.headers.get("content-type") ?? "image/jpeg",
        etag: upstream.headers.get("etag"),
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[image/emby]", message);
    return new Response("上游图片获取失败", { status: 502 });
  }

  if (!entry) return new Response("上游图片获取失败", { status: 502 });

  const headers = new Headers({
    "Content-Type": entry.contentType,
    "Cache-Control": CACHE_CONTROL,
  });
  if (entry.etag) headers.set("ETag", entry.etag);

  // 条件请求直接拿缓存里的 ETag 比对，不必再回源问一次
  if (entry.etag && request.headers.get("if-none-match") === entry.etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(entry.body.byteLength));
  return new Response(new Uint8Array(entry.body), { status: 200, headers });
}
