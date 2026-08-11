import { statusRoute } from "@/lib/api";
import { getNowWatching } from "@/lib/emby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 正在播放，和「最近在看」的列表分开。
 *
 * 两者的刷新节奏根本不同：列表 60 秒才被推一次，这条跟着播放事件走。
 * 从前合在一个端点里，慢的那半只能跟着快的那半一起被重取。
 */
export function GET() {
  return statusRoute(getNowWatching);
}
