import { connection } from "next/server";

import { resolveLyrics, type LyricsResult } from "@/lib/lyrics";
import { readNowListening } from "@/lib/now-listening-read";
import { withRedisScope } from "@/lib/redis";

/**
 * 同步歌词按需端点：`GET /api/lyrics`。
 *
 * 浏览器不带参数来问，站点按此刻在播那首自己决定去取哪首的歌词，不再由浏览器
 * 传参充当公开代理。响应带 `songId` 让浏览器对得上自己正在显示的是哪首（若与
 * 浏览器期望的不一致，浏览器不予采纳，只记 5 秒负缓存）。
 *
 * 快照说 `hasLyrics` 为 false 时直接答空（`{ songId, lines: [] }`）：目录已经说了
 * 没有，问 amp-api 也是 404，还会占一条「没有」的缓存。
 *
 * `Cache-Control` 一律 `no-store, no-cache, must-revalidate`：URL 没有任何参数，
 * 响应随时间变、不随 URL 变，浏览器和 CDN 都不能存。
 */

export type LyricsNowResponse = LyricsResult & { songId: string | null };

export async function GET(request: Request) {
  // cacheComponents 下没有 force-dynamic 可写，「每次请求都得跑一遍」由它明说
  await connection();

  /*
   * 挡别家网站借访客浏览器把这条端点当放大器，和动态封面同一条：
   * 同源 GET fetch 根本不带 Origin 头，按 Origin 卡会把自己人拒掉。
   * 改看 Sec-Fetch-Site —— 浏览器强制附带、页面脚本改不了：自己页面发的是
   * same-origin，别家网站发的一定是 cross-site，直接拒。地址栏直开是 none，
   * 放行；不带这个头的（curl、老浏览器）也放行。
   */
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonResponse({ songId: null, lines: [], error: "Origin not allowed" }, 403);
  }

  try {
    return await withRedisScope(async () => {
      const now = await readNowListening();
      if (!now || !now.songId) {
        return jsonResponse({ songId: null, lines: [] }, 200);
      }
      if (!now.hasLyrics) {
        return jsonResponse({ songId: now.songId, lines: [] }, 200);
      }
      const result = await resolveLyrics(now.songId);
      return jsonResponse({ songId: now.songId, ...result }, 200);
    });
  } catch (error) {
    console.error("[lyrics]", error);
    return jsonResponse({ songId: null, lines: [] }, 500);
  }
}

function jsonResponse(data: LyricsNowResponse, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
