import { revalidatePath } from "next/cache";
import { connection, NextResponse } from "next/server";

import { ingestFailed, telemetryAuthorized } from "@/lib/api";
import { expireStatusImmediately, FIRST_SCREEN_TAGS } from "@/lib/live-events";

/**
 * warmup 先打这里，再 GET `/`。
 *
 * 不走 ingestRoute：那条会把空 body 转给对端。这里没有上报可传。
 * `connection()` 和凭据 GET 同一个理由——没配密钥时鉴权短路，不碰请求期
 * API，Next 会试着把 `{ ok: true }` 预渲染成静态响应。
 *
 * expire 必须发生在响应之前：warmup 拿到 200 紧接着 GET `/`，丢进 after()
 * 就会和回填抢跑。
 *
 * EdgeOne 上 expire 仍只刷接到这次 POST 的那一个实例（见 expireStatus）。
 * GET 落到另一实例暖不到那份。Vercel 有共享 tag 存储，这条主要是为那边写的。
 */
export async function POST(request: Request) {
  await connection();
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);

  expireStatusImmediately(...FIRST_SCREEN_TAGS);
  revalidatePath("/");

  return NextResponse.json(
    { ok: true as const },
    { headers: { "Cache-Control": "no-store" } },
  );
}
