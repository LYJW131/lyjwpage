import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { putAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mac 上报器送来的 Apple Music 凭据。
 *
 * 单独一个端点，不并进遥测信封。信封里的一切最终都会经 telemetryState 落到
 * Redis 再由 /api/status/* 发给浏览器；凭据走那条路就是迟早泄露。分开之后
 * 「永远不能外发的东西」和「专门负责外发的代码」根本不在同一条路径上。
 *
 * 这个路由不打印请求体。别的 ingest 出错时会把原文截一段进日志方便对字段，
 * 这里绝不能那么做 —— 日志是会被转走、被翻的。
 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => {
    const row = ((await jsonBody(request)) ?? {}) as Record<string, unknown>;
    if (row.version !== 1) throw new Error("凭据协议 version 必须为 1");

    const musicUserToken = typeof row.music_user_token === "string" ? row.music_user_token : "";
    const developerToken = typeof row.developer_token === "string" ? row.developer_token : "";
    const expiresAt = typeof row.expires_at === "number" ? row.expires_at : 0;
    if (!musicUserToken) throw new Error("缺少 music_user_token");
    if (!developerToken) throw new Error("缺少 developer_token");
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) throw new Error("缺少有效的 expires_at");

    await putAppleMusicCredentials({
      musicUserToken,
      developerToken,
      expiresAt,
      receivedAt: Date.now(),
    });

    // 回执里只有到期时刻，没有 token 的任何片段
    return { expiresAt };
  });
}
