import { statusRoute } from "@/lib/api";
import { getNowWatching } from "@/lib/emby";
import { nowWatchingStatus } from "@/lib/status-cache";

/**
 * 正在播放，和「最近在看」的列表分开。
 *
 * 两者的刷新节奏根本不同：列表 60 秒才被推一次，这条跟着播放事件走。
 * 从前合在一个端点里，慢的那半只能跟着快的那半一起被重取。
 *
 * 进度是墙上的钟推出来的，不能冻在 `'use cache'` 快照里 —— 听歌那条的 overlay
 * 也是这个理由。这里现读 Redis 再投影，不然 next dev 里 tag 失效不灵、条会停
 * 在上报那一刻，看起来像播到一半其实早就过了。
 */
export function GET() {
  return statusRoute(nowWatchingStatus, () => getNowWatching());
}
