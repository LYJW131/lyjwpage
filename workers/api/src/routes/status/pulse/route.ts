import { statusRoute } from "@/lib/api";
import { pulseStatus } from "@/lib/status-sources";

export function GET() {
  return statusRoute(pulseStatus);
}
