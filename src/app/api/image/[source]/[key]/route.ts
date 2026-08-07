import { getCachedImage, getStoredImage, type ImageEntry } from "@/lib/image-store";
import { decodeImageToken } from "@/lib/image-proxy";

export const runtime = "nodejs";

const TIMEOUT_MS = 10_000;
/**
 * Emby 海报入库前压到的最长边。
 *
 * 上游按 maxHeight=400 给，回来是 712×400 的 JPEG，而页面上最宽的展示位是
 * 237 CSS px —— 2 倍屏也只要 474。压在入口做，和自定义歌单封面同一个路子：
 * 缓存里存的直接是小图，之后每次命中都省，顺带转成 WebP。
 *
 * 键里带版本号：存储格式变了而键不变的话，旧的未压缩条目会一直被端出来。
 */
/**
 * 不降分辨率，只靠格式省。
 *
 * 上游给的就是 712×400，而展示位 237 CSS px 在 Retina 上要 474 —— 压到 480
 * 一点余量都没有，窗口一宽就不够，实测肉眼可见地劣化。所以这里给到上游原始
 * 尺寸之上（withoutEnlargement 保证不会放大），省下来的全部来自 JPEG → WebP。
 */
const EMBY_MAX_DIMENSION = 720;
/** 展示尺寸比歌单封面大得多，默认那档 82 会吃掉细节 */
const EMBY_WEBP_QUALITY = 88;
const EMBY_CACHE_VERSION = "v3";
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
    const image = await getCachedImage(`emby:${EMBY_CACHE_VERSION}:${token}`, async () => {
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
    }, EMBY_MAX_DIMENSION, EMBY_WEBP_QUALITY);
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

export async function GET(
  request: Request,
  context: RouteContext<"/api/image/[source]/[key]">,
) {
  const { source, key } = await context.params;

  if (source === "asset") {
    const image = await getStoredImage(key);
    return image ? imageResponse(request, image) : new Response(null, { status: 404 });
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
