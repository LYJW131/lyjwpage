import { motionArtworkCacheKey, motionTtlMs, NO_MOTION, resolveMotionArtwork, type MotionResult } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { withStorageScope } from "@/lib/storage";

export type MotionResponse = MotionResult & { link: string | null };

function requestedLink(request: Request): string {
  return new URL(request.url).searchParams.get("url")?.trim() ?? "";
}

// 响应回显原始 link，缓存键必须包含原链接，不能只按解析后的身份合并。
export function edgeCacheKey(request: Request): string | null {
  const requested = requestedLink(request);
  const parsed = requested ? parseAppleMusicUrl(requested) : null;
  return parsed ? `${motionArtworkCacheKey(parsed)}:${encodeURIComponent(requested)}` : null;
}

export async function GET(request: Request) {
  const requested = requestedLink(request);
  const parsed = requested ? parseAppleMusicUrl(requested) : null;
  if (!parsed) {
    return jsonResponse(
      { link: requested || null, ...NO_MOTION, error: "Missing or invalid Apple Music URL" },
      400,
    );
  }
  try {
    const result = await withStorageScope(() => resolveMotionArtwork(parsed));
    return jsonResponse({ link: requested, ...result }, 200, Math.round(motionTtlMs() / 1000));
  } catch (error) {
    console.error("[motion-artwork]", error);
    return jsonResponse({ link: requested, ...NO_MOTION }, 500);
  }
}

function jsonResponse(data: MotionResponse, status = 200, cacheTtl = 0): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        cacheTtl > 0
          ? `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
          : "no-store, no-cache, must-revalidate",
    },
  });
}
