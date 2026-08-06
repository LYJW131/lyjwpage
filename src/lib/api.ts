import { NextResponse } from "next/server";

import type { StatusResponse } from "@/lib/types";

/**
 * 把一个取数函数包成统一的 Route Handler 响应。
 * 上游挂了不返回 5xx —— 前端拿到 ok:false 后渲染降级态即可，
 * 不让一个离线的充电头把整页 SWR 变成错误状态。
 */
export async function statusRoute<T>(
  loader: () => Promise<T>,
): Promise<NextResponse<StatusResponse<T>>> {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await loader();
    return NextResponse.json(
      { ok: true as const, data, fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[status]", message);
    return NextResponse.json(
      { ok: false as const, error: message, fetchedAt },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
