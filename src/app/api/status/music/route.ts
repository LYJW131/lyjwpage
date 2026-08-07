import { statusRoute } from "@/lib/api";
import { getMusicPayload } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(getMusicPayload);
}
