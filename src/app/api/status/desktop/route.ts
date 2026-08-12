import { statusRoute } from "@/lib/api";
import { getDesktopPayload } from "@/lib/telemetry";

export function GET() {
  return statusRoute(async () => getDesktopPayload());
}
