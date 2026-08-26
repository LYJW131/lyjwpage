import { isStale, playstationStaleMs } from "@/lib/freshness";
import { statusRoute } from "@/lib/api";
import { assertPresenceFresh, getPlayingNow } from "@/lib/playstation";
import { playingNowStatus } from "@/lib/status-cache";

/**
 * PlayStation 在线状态与此刻正在玩的游戏。
 *
 * 断流判定在 overlay 里每次请求现算，不进快照 —— 和活动圆环的
 * withActivityFreshness、充电头的 withChargerFreshness 同一套：这类结论光靠
 * 时间流逝就会翻面，冻进 'use cache' 的那份永远翻不过来。
 *
 * 只判缓存里那份不够。presence 内容没变时 ingest 只推普通 tag，本进程吃不到
 * （本地另一份 next、EdgeOne 没接到上报的实例）就会把 observedAt 冻到 expire。
 * 缓存过期了就现读 Redis 再判，别把「Worker 其实刚报过」当成断流。
 */
export function GET() {
  return statusRoute(playingNowStatus, async (data) => {
    if (!isStale({ now: Date.now(), at: data.observedAt, windowMs: playstationStaleMs() })) {
      return data;
    }
    return assertPresenceFresh(await getPlayingNow());
  });
}
