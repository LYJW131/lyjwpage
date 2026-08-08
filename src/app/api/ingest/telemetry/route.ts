import { ingestFailed, ingestRoute, jsonBody } from "@/lib/api";
import { recordTelemetryEnvelope, telemetryAuthorized } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 版本化的统一遥测入口；modules 支持部分更新。 */
export async function POST(request: Request) {
  if (!telemetryAuthorized(request)) return ingestFailed("未授权", 401);
  return ingestRoute(async () => recordTelemetryEnvelope(await jsonBody(request)));
}
