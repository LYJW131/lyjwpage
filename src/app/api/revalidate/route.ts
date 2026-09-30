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

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return failure("站点未配置 REVALIDATE_SECRET", 503);
  }
  if (!authorized(request, secret)) return failure("未授权", 401);

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
