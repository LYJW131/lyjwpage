import {
  recordTelemetryEnvelope,
  telemetryAuthorized,
} from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 版本化的统一遥测入口；modules 支持部分更新。 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return new Response("未授权", { status: 401 });
  try {
    const result = await recordTelemetryEnvelope(await request.json());
    return Response.json(result, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(message, { status: 400 });
  }
}
