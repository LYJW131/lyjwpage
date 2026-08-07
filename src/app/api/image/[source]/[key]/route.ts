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
