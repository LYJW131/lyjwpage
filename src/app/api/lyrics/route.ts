import { connection } from "next/server";

import { readStatus } from "@/lib/api";
import { NO_LYRICS, resolveLyrics, type LyricsResult } from "@/lib/lyrics";
import { pickNowListening } from "@/lib/now-listening";
import { withRedisScope } from "@/lib/redis";
import { readLiveness } from "@/lib/reporter-liveness";
import { nowListeningStatus } from "@/lib/status-cache";

/**
 * 同步歌词端点：`GET /api/lyrics?song=<目录曲目 ID>`。
 *
 * 和动态封面（app/api/motion-artwork）是同一种东西：浏览器按 hero 上此刻那首
 * 的 `songId` 来问，站点拿扒来的 web token 去 amp-api 取，结论进 lib/cache。
 *
 * 但 `Cache-Control` 和那边不同：**只允许浏览器私有缓存，不进 CDN。** 下面那道
 * 白名单是每次请求现查的，`public` + `s-maxage` 会让 CDN 把一次放行的响应原样
 * 发给之后任何人 —— 那首歌早不在名单里了，歌词照样能拿到七天，门等于没设。
 * 重复请求本来就少（同一页里 hooks/use-lyrics 按 songId 只问一次），CDN 那层
 * 省下的不值这个洞。
 *
 * **比动态封面多一道门：只答此刻在播和排在后面那几首。** 动态封面拿到的只是
 * 一个视频地址，这里吐的是整首歌的歌词正文，而且是拿我的订阅身份换来的 ——
 * 不设门的话它就是一个「任何人拿任意 ID 换歌词」的公开代理。名单来自
 * `/api/status/listening/now` 那份快照（当前曲 + `upcomingSongIds`），正好是
 * 卡片会问到的全部；不在名单里的一律 404，不区分「不在名单」和「没有歌词」，
 * 免得名单本身变成探针。
 *
 * 上游出错一律 no-store，理由同动态封面：错误缓存住了，token 早换好了、
 * 同一首还是拿不到。
 */
export async function GET(request: Request) {
  // cacheComponents 下没有 force-dynamic 可写，「每次请求都得跑一遍」由它明说
  await connection();

  // 同源 GET fetch 不带 Origin，按 Sec-Fetch-Site 卡别家网站，见 motion-artwork 那条
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonResponse({ ...NO_LYRICS, error: "Origin not allowed" }, 403);
  }

  const songId = new URL(request.url).searchParams.get("song")?.trim() ?? "";
  if (!/^\d{1,20}$/.test(songId)) {
    return jsonResponse({ ...NO_LYRICS, error: 'Missing or invalid "song" query parameter' }, 400);
  }

  try {
    return await withRedisScope(async () => {
      if (!(await allowed(songId))) return jsonResponse(NO_LYRICS, 404);
      const result = await resolveLyrics(songId);
      return jsonResponse(result, 200, result.lines.length ? 7 * 86400 : 3600);
    });
  } catch (error) {
    // 响应体保持通用形状，错误原文只进日志不外带
    console.error("[lyrics]", error);
    return jsonResponse(NO_LYRICS, 500);
  }
}

/**
 * 在不在此刻那份快照的名单里。
 *
 * 和 `/api/status/listening/now` 读的是**同一份、同一种取法**（readStatus 按
 * STATUS_CACHE 选冻的还是直读）：浏览器是从那条端点拿到 songId 再来问的，这边
 * 要是走另一路，国内那份部署上就会出现「那边已经是新歌、这边名单还是 10 分钟前
 * 的」—— 404 一次，浏览器那侧就把这首记成没有歌词，整首都不会再问。
 *
 * 选 hero 也和那条端点同一套（pickNowListening：存活、暂停宽限、HomePod 静默都
 * 在这一步现算）：快照里两个候选都还在，但上报器掉线、暂停超过宽限的那个已经
 * 不是「此刻在播」，它的歌不该再放行。
 */
async function allowed(songId: string): Promise<boolean> {
  const [envelope, liveness] = await Promise.all([
    readStatus(nowListeningStatus),
    readLiveness(),
  ]);
  if (!envelope.ok) return false;
  const now = pickNowListening(envelope.data, liveness);
  return now.songId === songId || now.upcomingSongIds.includes(songId);
}

function jsonResponse(data: LyricsResult, status = 200, cacheTtl = 0): Response {
  return Response.json(data, {
    status,
    headers: {
      // private：只许这一个浏览器留，共享缓存（CDN、代理）一律不存，理由见文件头
      "Cache-Control":
        cacheTtl > 0 ? `private, max-age=${cacheTtl}` : "no-store, no-cache, must-revalidate",
    },
  });
}
