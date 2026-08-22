import { connection, NextResponse } from "next/server";

import { ingestFailed, ingestRoute, telemetryAuthorized } from "@/lib/api";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { prepareRecentlyPlayedReport } from "@/lib/apple-music-store";
import { fanout, LISTENING_TAG } from "@/lib/live-events";
import { withRedisScope } from "@/lib/redis";

/**
 * 「最近在听」的上报入口，推送方是 reporters/apple-music-reporter。
 *
 * 这个路径两个方向都走：**POST 交数据，GET 取干活要用的凭据**，同一把锁。
 *
 * GET 存在的理由：签 developer token 的 .p8 私钥按设计不出 Mac 的钥匙串，
 * 上报器自己签不出来，只能问站点要 Mac 推上来的那份。让它直连 Redis 也能拿到，
 * 但那样上报器就多持有一份 Redis 凭据、还得自己认识键名和存储格式；走 HTTP 的话
 * 它只需要认识这一个地址和那把已经有了的密钥。
 *
 * 代价说清楚：TELEMETRY_INGEST_SECRET 从此和 Apple Music 凭据同等敏感 ——
 * 拿到密钥就能取走 token。四个上报侧本来就共用它，轮换时一起换。
 */
export async function POST(request: Request) {
  return ingestRoute(request, async (body) => {
    const { items, changed, listening, commit } = await prepareRecentlyPlayedReport(body);
    /**
     * 带整份数据推。省掉每个在线访客各一次回源 —— 发失效通知的话，成本是按
     * 人头乘的，而这份整份才 4.4 KB。理由详见 lib/live-events 的事件定义。
     *
     * 只在内容真的变了时发：上报器每 10 分钟兜底整推一次，跟着发就成了定时广播。
     * 推的那份和落库那份同源，所以两件事同时做，见 fanout。
     */
    await fanout({
      writes: [commit()],
      events: changed ? [{ type: "listening", payload: listening }] : [],
      tags: changed ? [LISTENING_TAG] : [],
    });
    return { items, changed };
  });
}

/**
 * 上报器取凭据。给的是 Mac 上报器现签的那份，站点只是转交，不做任何加工。
 *
 * `connection()` 和状态路由那边同一个理由（见 lib/api 的 statusResponse），
 * 但这里更要紧：这条路由眼下变成动态的只是**顺带** —— telemetryAuthorized 读了
 * request.headers。而没配 TELEMETRY_INGEST_SECRET 时那行会被短路掉，于是没有
 * 任何请求期 API 被碰过，Next 就有理由试着把一份凭据预渲染成静态响应。
 * `no-store` 同理：别让这份东西有机会被中间层留下。
 */
export async function GET(request: Request) {
  await connection();
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);

  return withRedisScope(async () => {
    const result = await readAppleMusicCredentials();
    if (!result.ok) {
      // 两种没有，修法相反，别让上报器只看见一句「没有凭据」
      return ingestFailed(
        result.reason === "redis-unreachable"
          ? "读不到 Apple Music 凭据 —— Redis 连不上，凭据本身可能还在"
          : "没有收到 Mac 上报器的 Apple Music 凭据 —— 在上报器的设置里授权 Apple Music",
        503,
      );
    }

    const { developerToken, musicUserToken, expiresAt } = result.credentials;
    return NextResponse.json(
      {
        ok: true as const,
        data: { developerToken, musicUserToken, expiresAt },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
