import { statusRoute } from "@/lib/api";
import { playingStatus } from "@/lib/status-cache";

/** PlayStation 最近游玩列表。 */
export function GET() {
  return statusRoute(playingStatus);
}
