import { lyricsCacheKey, resolveLyrics, type LyricsResult } from "@/lib/lyrics";
import { withStorageScope } from "@/lib/storage";

/**
 * 按目录曲目 ID 查同步歌词，`song` 必填。首屏那首的歌词也由站点按卡读取时来这里取
 * （src/lib/first-screen.ts）；结果只由曲目决定，不随状态变化，所以能长缓存。
 */
export type LyricsResponse = LyricsResult & { songId: string | null };

function requestedSong(request: Request): string {
  return new URL(request.url).searchParams.get("song")?.trim() ?? "";
}

const validSong = (song: string): boolean => /^\d{1,20}$/.test(song);

/** 边缘缓存的键：参数不合法时为 null，那种 400 不进缓存 */
export function edgeCacheKey(request: Request): string | null {
  const requested = requestedSong(request);
  return validSong(requested) ? lyricsCacheKey(requested) : null;
}

export async function GET(request: Request) {
  const requested = requestedSong(request);
  if (!validSong(requested)) {
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
