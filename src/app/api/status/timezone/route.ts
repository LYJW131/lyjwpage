import { statusRoute } from "@/lib/api";
import { getTimezonePayload } from "@/lib/telemetry";

export function GET() {
  return statusRoute(async () => getTimezonePayload());
}
