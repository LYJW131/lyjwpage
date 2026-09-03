import { connection } from "next/server";

import { NO_MOTION, resolveMotionArtwork, type MotionResult } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { readHeroLink } from "@/lib/now-listening-read";
import { withRedisScope } from "@/lib/redis";

/**
 * 动态封面解析按需端点：`GET /api/motion-artwork`。
 *
 * 服务端按卡片 hero 此刻挂的链接自决：在播就是那首目录解析出的 `link`，闲置退回
 * 「最近在听」列表第一条（和 listening-card 选 hero 同一套，见 lib/now-listening-read），
 * 浏览器不再传参。响应带 `link` 让客户端核对是否为期望的那首，不匹配时不予采纳。
 *
 * `Cache-Control` 一律 `no-store, no-cache, must-revalidate`：URL 无参数、内容随
 * 时间变，CDN 那层不再缓存。Redis 结论缓存仍在 `lib/motion-artwork` 共享。
 * 上游出错一律 no-store，错误只进日志不外带。
 */

export type MotionNowResponse = MotionResult & { link: string | null };

export async function GET(request: Request) {
  // cacheComponents 下没有 force-dynamic 可写，「每次请求都得跑一遍」由它明说
  await connection();

  /*
   * 挡别家网站借访客浏览器把这条端点当放大器，和歌词同一条：
   * 同源 GET fetch 根本不带 Origin 头，按 Origin 卡会把自己人拒掉。
   * 改看 Sec-Fetch-Site —— 浏览器强制附带、页面脚本改不了：自己页面发的是
   * same-origin，别家网站发的一定是 cross-site，直接拒。地址栏直开是 none，
   * 放行；不带这个头的（curl、老浏览器）也放行。
   */
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonResponse({ link: null, ...NO_MOTION, error: "Origin not allowed" }, 403);
  }

  try {
    return await withRedisScope(async () => {
      // 在播就是那首的链接，闲置退回列表第一条 —— 和卡片选 hero 同一套，见 lib/now-listening-read
      const link = await readHeroLink();
      const parsed = link ? parseAppleMusicUrl(link) : null;
      if (!parsed) {
        return jsonResponse({ link, ...NO_MOTION }, 200);
      }
      const result = await resolveMotionArtwork(parsed);
      return jsonResponse({ link, ...result }, 200);
    });
  } catch (error) {
    console.error("[motion-artwork]", error);
    return jsonResponse({ link: null, ...NO_MOTION }, 500);
  }
}

function jsonResponse(data: MotionNowResponse, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
