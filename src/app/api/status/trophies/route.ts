import { statusRoute } from "@/lib/api";
import { trophiesStatus } from "@/lib/status-cache";

/** PlayStation 奖杯目录。 */
export function GET() {
  return statusRoute(trophiesStatus);
}
