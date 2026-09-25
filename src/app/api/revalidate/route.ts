import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { expireStatusTags } from "@/lib/status-revalidation";
import { parseRevalidateRequest } from "@/lib/revalidate-request";

function failure(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function authorized(request: Request, expected: string) {
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Worker 处理完一次上报之后，让这份部署的 `'use cache'` 过期。
 *
 * 写入已经不在这个进程里发生了（落库、推送都在 workers/api），但 `revalidateTag`
 * 只能在 Next 进程内调 —— 所以要留这一个口子。它只传 tag 名，不传数据：数据早就
 * 在 SQLite 里了，下一次读自己会去拿。请求体的形状和校验见 lib/revalidate-request。
 *
 * 鉴权用 REVALIDATE_SECRET，只有这里和 api Worker 两边有。过渡期也认旧的
 * TELEMETRY_INGEST_SECRET：Worker 先后切换时两边不必同一刻换好，全部上报器迁到
 * Access 之后删掉这一支。
 * **没配密钥就一律 503**：这一个端点公网可达、专供 Worker，没有「本地开发不配密钥」的场景。
 */
export async function POST(request: Request) {
  const secrets = [process.env.REVALIDATE_SECRET, process.env.TELEMETRY_INGEST_SECRET].filter(
    (value): value is string => !!value,
  );
  if (!secrets.length) {
    return failure("站点未配置 REVALIDATE_SECRET", 503);
  }
  if (!secrets.some((secret) => authorized(request, secret))) return failure("未授权", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("请求体不是合法 JSON", 400);
  }

  const parsed = parseRevalidateRequest(body);
  if (!parsed.ok) return failure(parsed.error, 400);

  const { tags } = parsed.value;
  await expireStatusTags(tags);
  return NextResponse.json({ ok: true as const, data: { tags } });
}
