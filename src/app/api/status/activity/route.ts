import { statusRoute } from "@/lib/api";
import { getActivityPayload } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(async () => getActivityPayload());
}
