import { statusRoute } from "@/lib/api";
import { playingNowStatus } from "@/lib/status-cache";

/** PlayStation 在线状态与此刻正在玩的游戏。 */
export function GET() {
  return statusRoute(playingNowStatus);
}
