import { resolveLyrics, type LyricsResult } from "@/lib/lyrics";
import { withStorageScope } from "@/lib/storage";

/**
 * 按目录曲目 ID 查同步歌词，`song` 必填。此刻那首的首屏歌词在 `/api/home` 的
 * `lyrics` 字段里；这里只做按键查询，结果不随状态变化，所以能长缓存。
 */
export type LyricsResponse = LyricsResult & { songId: string | null };

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("song")?.trim() ?? "";
  if (!/^\d{1,20}$/.test(requested)) {
    return jsonResponse(
      { songId: null, lines: [], error: 'Missing or invalid "song" query parameter' },
      400,
    );
  }
  try {
    const result = await withStorageScope(() => resolveLyrics(requested));
    return jsonResponse(
      { songId: requested, ...result },
      200,
      result.lines.length ? 7 * 86400 : 3600,
    );
  } catch (error) {
    // 响应体保持通用形状，错误原文只进日志不外带
    console.error("[lyrics]", error);
    return jsonResponse({ songId: requested, lines: [] }, 500);
  }
}

function jsonResponse(data: LyricsResponse, status = 200, cacheTtl = 0): Response {
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
