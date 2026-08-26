import { statusRoute } from "@/lib/api";
import { playingStatus } from "@/lib/status-cache";

/** PlayStation 最近游玩列表。上报多少发多少，条数旋钮只有 Worker 那个。 */
export function GET() {
  return statusRoute(playingStatus);
}
