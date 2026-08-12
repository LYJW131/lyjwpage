import { statusRoute } from "@/lib/api";
import { getNowListening } from "@/lib/telemetry";

export function GET() {
  return statusRoute(getNowListening);
}
