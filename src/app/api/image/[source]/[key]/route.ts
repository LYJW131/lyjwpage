import { getRecentlyPlayed, libraryPlaylistArtwork } from "@/lib/apple-music";
import { getCachedImage, getStoredImage, type ImageEntry } from "@/lib/image-store";
import { decodeImageToken } from "@/lib/image-proxy";

export const runtime = "nodejs";

const TIMEOUT_MS = 10_000;
const CACHE_CONTROL = "public, max-age=31536000, immutable";
type ImageLoadResult =
  | { image: ImageEntry }
  | { error: string; status: 403 | 500 | 502 };

async function loadEmbyImage(token: string): Promise<ImageLoadResult> {
  const decoded = decodeImageToken(token);
  if (!decoded.ok) return { error: decoded.reason, status: 403 } as const;

  const base = (process.env.EMBY_URL ?? "").replace(/\/+$/, "");
  if (!base) return { error: "未配置 EMBY_URL", status: 500 } as const;

  const { id, kind, tag, height } = decoded.params;
  const upstreamUrl =
    `${base}/emby/Items/${id}/Images/${kind}` +
    `?${new URLSearchParams({ tag, maxHeight: String(height) })}`;

  try {
    const image = await getCachedImage(`emby:${token}`, async () => {
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
    return image ? { image } : { error: "上游图片获取失败", status: 502 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[image/emby]", message);
    return { error: "上游图片获取失败", status: 502 } as const;
  }
}

function imageResponse(request: Request, image: ImageEntry) {
  const headers = new Headers({
    "Content-Type": image.contentType,
    "Cache-Control": CACHE_CONTROL,
  });
  if (image.etag) headers.set("ETag", image.etag);

  if (image.etag && request.headers.get("if-none-match") === image.etag) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("Content-Length", String(image.body.byteLength));
  return new Response(new Uint8Array(image.body), { status: 200, headers });
}

/**
 * 自建歌单封面。
 *
 * 资料库给的是预签名的 S3 地址（X-Amz-Expires=86400），24 小时就失效，
 * 而且带着签名，不该直接出现在公开页面上。所以由服务端换取、取回字节再转发，
 * 前端只看到 /api/image/apple/<globalId> 这个稳定地址。
 */
async function loadApplePlaylistImage(playlistId: string): Promise<ImageLoadResult> {
  try {
    /**
     * 只服务当前最近播放列表里出现过的歌单。
     *
     * 这个端点没有鉴权，不加这道限制的话，知道 id 就能取到资料库里**任意**
     * 歌单的封面 —— 页面根本不展示的那些也包括在内。列表本身有 30 秒缓存，
     * 这次校验基本不产生额外请求。
     */
    const items = await getRecentlyPlayed();
    if (!items.some((item) => item.id === playlistId)) {
      return { error: "不在当前展示的列表里", status: 403 } as const;
    }

    const image = await getCachedImage(`apple-playlist:${playlistId}`, async () => {
      const url = await libraryPlaylistArtwork(playlistId);
      if (!url) throw new Error("资料库里没有这个歌单的封面");
      const upstream = await fetch(url, {
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
    return image ? { image } : { error: "封面获取失败", status: 502 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[image/apple]", message);
    return { error: message, status: 502 };
  }
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/image/[source]/[key]">,
) {
  const { source, key } = await context.params;

  if (source === "asset") {
    const image = await getStoredImage(key);
    return image ? imageResponse(request, image) : new Response(null, { status: 404 });
  }

  if (source === "apple") {
    const result = await loadApplePlaylistImage(key);
    if ("error" in result) {
      return new Response(result.error, { status: result.status });
    }
    return imageResponse(request, result.image);
  }

  if (source === "emby") {
    const result = await loadEmbyImage(key);
    if ("error" in result) {
      return new Response(result.error, { status: result.status });
    }
    return imageResponse(request, result.image);
  }

  return new Response(null, { status: 404 });
}
