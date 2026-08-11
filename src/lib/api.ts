import { NextResponse } from "next/server";

import type { IngestFailure, IngestResponse, StatusResponse } from "@/lib/types";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 增量拉取的游标。
 *
 * 缺省、或者带了个解析不出有限数的值，都按「要整份」处理 —— 客户端第一次拉
 * 曲线时本来就没有游标，和参数写坏是同一种情况，服务端一视同仁发全量就对了。
 */
export function sinceParam(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 把一个取数函数包成统一的 Route Handler 响应。
 * 上游挂了不返回 5xx —— 前端拿到 ok:false 后渲染降级态即可，
 * 不让一个离线的充电头把整页 SWR 变成错误状态。
 */
export async function statusRoute<T>(
  loader: () => Promise<T>,
): Promise<NextResponse<StatusResponse<T>>> {
  /**
   * 时间戳放响应头，不进 body：进了 body 就等于每次响应都不一样，
   * 前端再想判断「数据变没变」永远为假 —— 见 StatusResponse 的注释。
   */
  const headers = {
    "Cache-Control": "no-store",
    "X-Fetched-At": new Date().toISOString(),
  };
  try {
    const data = await loader();
    return NextResponse.json({ ok: true as const, data }, { headers });
  } catch (error) {
    const message = reason(error);
    // 带上栈：降级信封只把 message 发给页面，没有栈的话服务端日志里
    // 一句「Cannot read properties of null」根本定位不到是哪一处
    console.error("[status]", error instanceof Error ? (error.stack ?? message) : message);
    return NextResponse.json(
      { ok: false as const, error: message },
      { status: 200, headers },
    );
  }
}

/**
 * 读请求体。
 *
 * 解析失败统一抛这一句 —— 不然漏出去的是 V8 那句英文 parser 报错，四个端点
 * 各抛各的，上报器那边看到的错误文案还不一样。
 */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

/**
 * 上报被拒。
 *
 * 和 statusRoute 相反，ingest 这边该用什么状态码就用什么 —— 对面是上报器和
 * webhook，不是页面，它们要靠状态码决定重不重试。信封统一成 JSON，是因为
 * 从前四个入口各发各的：有的返回 JSON、有的甩一句纯文本，写上报器那侧得按
 * 端点分别解析。
 */
export function ingestFailed(message: string, status: number): NextResponse<IngestFailure> {
  return NextResponse.json({ ok: false as const, error: message }, { status });
}

/**
 * 把一次上报的落库过程包成统一响应。
 *
 * 成功一律 202：数据已收下，但后续的扇出（实时推送、缓存失效）是异步的，
 * 200 会给人「全部生效」的错觉。handler 里抛出来的按 400 处理 —— 到这一步
 * 还失败的都是 payload 本身的问题，上报器重发同一份也不会变好。
 */
export async function ingestRoute<T>(
  handler: () => Promise<T>,
): Promise<NextResponse<IngestResponse<T>>> {
  try {
    return NextResponse.json({ ok: true as const, data: await handler() }, { status: 202 });
  } catch (error) {
    const message = reason(error);
    console.error("[ingest]", message);
    return ingestFailed(message, 400);
  }
}
