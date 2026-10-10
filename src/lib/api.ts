import { AwaitingReport } from "@/lib/awaiting-report";
import { LagResult } from "@/lib/lag-result";
import { withStorageScope } from "@/lib/storage";
import type { StatusResponse } from "@/lib/types";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sinceParam(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sinceDateParam(request: Request): string | undefined {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw == null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return raw;
}

// 缺省表示全量，空数组表示空集；两者不能合并成同一种回退。
export function titleIdsParam(request: Request): string[] | undefined {
  const raw = new URL(request.url).searchParams.get("titleids");
  if (raw == null) return undefined;
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function statusEnvelope<T>(
  loader: () => Promise<T | LagResult<T>>,
): Promise<StatusResponse<T>> {
  return withStorageScope(async () => {
    try {
      const value = await loader();
      const servedAt = Date.now();
      if (value instanceof LagResult) {
        return { ok: true, data: value.data as T, updatedAt: value.updatedAt, servedAt };
      }
      return { ok: true, data: value, servedAt };
    } catch (error) {
      const message = reason(error);
      if (error instanceof AwaitingReport) {
        console.warn("[status]", message);
      } else {
        console.error("[status]", error instanceof Error ? (error.stack ?? message) : message);
      }
      return { ok: false, error: error instanceof AwaitingReport ? message : "Status unavailable" };
    }
  });
}

// 除首帧时钟 servedAt 外，动态时间戳留在响应头，避免无变化的 payload 每次都触发深比较失败。
export function statusResponse<T>(envelope: StatusResponse<T>): Response {
  return Response.json(envelope, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Fetched-At": new Date().toISOString(),
    },
  });
}
