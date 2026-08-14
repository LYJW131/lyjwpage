import { connection, NextResponse } from "next/server";

import { withRedisScope } from "@/lib/redis";
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
 * 把一个取数函数包成统一的 status 信封。
 * 上游挂了不往上抛 —— 前端拿到 ok:false 后渲染降级态即可，
 * 不让一个离线的充电头把整页 SWR 变成错误状态。
 *
 * 路由和首屏服务端渲染共用这一份：两处的降级形状必须一模一样，
 * 否则同一张卡在首屏和轮询之后会走不同的分支。
 */
export async function statusEnvelope<T>(
  loader: () => Promise<T>,
): Promise<StatusResponse<T>> {
  return withRedisScope(async () => {
    try {
      return { ok: true, data: await loader() };
    } catch (error) {
      const message = reason(error);
      // 带上栈：降级信封只把 message 发给页面，没有栈的话服务端日志里
      // 一句「Cannot read properties of null」根本定位不到是哪一处
      console.error("[status]", error instanceof Error ? (error.stack ?? message) : message);
      return { ok: false, error: message };
    }
  });
}

function statusJson<T>(envelope: StatusResponse<T>): NextResponse<StatusResponse<T>> {
  return NextResponse.json(envelope, {
    status: 200,
    /**
     * 时间戳放响应头，不进 body：进了 body 就等于每次响应都不一样，
     * 前端再想判断「数据变没变」永远为假 —— 见 StatusResponse 的注释。
     */
    headers: {
      "Cache-Control": "no-store",
      "X-Fetched-At": new Date().toISOString(),
    },
  });
}

/**
 * 活路径：每次进函数。目前没有路由走整段现算；listening/now 的候选走
 * `'use cache'`，来源选择和 expiresInMs 在缓存外现算。connection() 现算的
 * 写法还留着，以免以后又有不能冻的整段取数。
 *
 * cacheComponents 下没有 force-dynamic 可写了，「每次请求都得跑一遍」只能由
 * connection() 明说。少了它 Next 会试着在构建期把这些 GET 预渲染成静态响应，
 * 而下面 statusEnvelope 的 try/catch 会把预渲染的中断信号一并吞掉（内置文档
 * 专门警告过这一点），构建期那份 ok:false 就被烤进静态响应，客户端从此永远
 * 轮询到同一个错误。
 */
export async function statusRoute<T>(
  loader: () => Promise<T>,
): Promise<NextResponse<StatusResponse<T>>> {
  await connection();
  return statusJson(await statusEnvelope(loader));
}

/**
 * 快照走 `'use cache'`（见 lib/status-cache），函数仍然每次进 —— connection()
 * 防止构建期把 GET 烤死。overlay 在缓存外跑，给存活这种心跳更新、不能冻进
 * 快照的字段现盖一层。
 */
export async function statusCachedRoute<T>(
  load: () => Promise<StatusResponse<T>>,
): Promise<NextResponse<StatusResponse<T>>>;
export async function statusCachedRoute<T, U>(
  load: () => Promise<StatusResponse<T>>,
  overlay: (data: T) => Promise<U> | U,
): Promise<NextResponse<StatusResponse<U>>>;
export async function statusCachedRoute<T, U>(
  load: () => Promise<StatusResponse<T>>,
  overlay?: (data: T) => Promise<U> | U,
): Promise<NextResponse<StatusResponse<T | U>>> {
  await connection();
  return withRedisScope(async () => {
    const envelope = await load();
    if (!envelope.ok || !overlay) return statusJson(envelope);
    return statusJson({ ok: true, data: await overlay(envelope.data) });
  });
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
  return withRedisScope(async () => {
    try {
      return NextResponse.json({ ok: true as const, data: await handler() }, { status: 202 });
    } catch (error) {
      const message = reason(error);
      console.error("[ingest]", message);
      return ingestFailed(message, 400);
    }
  });
}
