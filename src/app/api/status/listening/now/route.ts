import { statusRoute } from "@/lib/api";
import { getNowListening } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(getNowListening);
}
