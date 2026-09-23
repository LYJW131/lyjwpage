import { NO_MOTION, resolveMotionArtwork, type MotionResult } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { withStorageScope } from "@/lib/storage";

/**
 * 按 Apple Music 链接查动态封面，`url` 必填。只做按键查询，结果不随状态变化，
 * 所以能长缓存。
 */
export type MotionResponse = MotionResult & { link: string | null };

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  const parsed = requested ? parseAppleMusicUrl(requested) : null;
  if (!parsed) {
    return jsonResponse(
      { link: requested || null, ...NO_MOTION, error: "Missing or invalid Apple Music URL" },
      400,
    );
  }
  try {
    const result = await withStorageScope(() => resolveMotionArtwork(parsed));
    // 有 24 小时、确认没有 1 小时，和 lib/motion-artwork 里 SQLite 那两档同一个尺度
    return jsonResponse({ link: requested, ...result }, 200, result.hasMotion ? 86400 : 3600);
  } catch (error) {
    // 响应体保持通用形状，错误原文只进日志不外带
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
