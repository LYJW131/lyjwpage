import { NextResponse } from "next/server";

import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { recordRecentlyPlayedReport } from "@/lib/apple-music-store";
import { publish } from "@/lib/live-events";
import { telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => {
    const result = await recordRecentlyPlayedReport(await jsonBody(request));
    /**
     * 只发失效通知，不带数据。
     *
     * 列表整份有十几 KB，而浏览器手上多半已经有一份几乎相同的；让它自己回来取
     * 一次更省，也和 presence 那条一个形状。只在内容真的变了时发 —— 上报器
     * 每 10 分钟兜底整推一次，跟着发就成了定时广播。
     */
    if (result.changed) await publish({ type: "listening", payload: null });
    return result;
  });
}

/** 上报器取凭据。给的是 Mac 上报器现签的那份，站点只是转交，不做任何加工 */
export async function GET(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);

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
  return NextResponse.json({
    ok: true as const,
    data: { developerToken, musicUserToken, expiresAt },
  });
}
