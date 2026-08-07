import { statusRoute } from "@/lib/api";
import { getDesktopPayload } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(async () => getDesktopPayload());
}
