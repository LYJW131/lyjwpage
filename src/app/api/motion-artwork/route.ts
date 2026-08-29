import { connection } from "next/server";

import { NO_MOTION, resolveMotionArtwork, type MotionResult } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { withRedisScope } from "@/lib/redis";

/**
 * 动态封面解析端点：`GET /api/motion-artwork?url=<Apple Music 链接>`。
 *
 * 前身是独立部署的 Cloudflare Worker（am-motion-artwork），现在浏览器打的是
 * 同源，CORS / 来源白名单那套整个不需要了。响应形状、状态码和缓存语义都沿用
 * Worker 的约定，客户端（hooks/use-motion-artwork）不用按新旧分路。
 *
 * 缓存两层：结论存 lib/cache（Redis，跨实例共享，TTL 见 lib/motion-artwork），
 * `Cache-Control` 的 s-maxage 再让 CDN 把同一条 URL 的重复请求挡在函数外。
 * 上游出错一律 no-store —— 从前错误也按「没有动态封面」缓存过一小时，token
 * 早换好了、同一个 URL 还是拿不到正确答案，这个教训别再犯。
 */
export async function GET(request: Request) {
  // cacheComponents 下没有 force-dynamic 可写，「每次请求都得跑一遍」由它明说
  await connection();

  const targetUrl = new URL(request.url).searchParams.get("url");
  if (!targetUrl) {
    return jsonResponse({ ...NO_MOTION, error: 'Missing "url" query parameter' }, 400);
  }

  const parsed = parseAppleMusicUrl(targetUrl);
  if (!parsed) {
    return jsonResponse({ ...NO_MOTION, error: "Invalid Apple Music URL" }, 400);
  }

  try {
    const result = await withRedisScope(() => resolveMotionArtwork(parsed));
    return jsonResponse(result, 200, result.hasMotion ? 86400 : 3600);
  } catch (error) {
    // 响应体保持通用形状，错误原文只进日志不外带（照 Worker 时代的做法）
    console.error("[motion-artwork]", error);
    return jsonResponse(NO_MOTION, 500);
  }
}

function jsonResponse(data: MotionResult, status = 200, cacheTtl = 0): Response {
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
