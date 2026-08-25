import { statusRoute } from "@/lib/api";
import { assertPresenceFresh } from "@/lib/playstation";
import { playingNowStatus } from "@/lib/status-cache";

/**
 * PlayStation 在线状态与此刻正在玩的游戏。
 *
 * 断流判定在 overlay 里每次请求现算，不进快照 —— 和活动圆环的
 * withActivityFreshness、充电头的 withChargerFreshness 同一套：这类结论光靠
 * 时间流逝就会翻面，冻进 'use cache' 的那份永远翻不过来。
 */
export function GET() {
  return statusRoute(playingNowStatus, (data) => assertPresenceFresh(data));
}
