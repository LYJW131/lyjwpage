import { statusRoute } from "@/lib/api";
import { getNowWatching } from "@/lib/emby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 正在播放，和「最近在看」的列表分开。
 *
 * 两者的数据源根本不同：列表是后端定时轮询 Emby 的 Resume 接口（带缓存），
 * 这条纯粹由 Emby 的 webhook 驱动，没在播时一个上游请求都不打。
 * 从前合在一个端点里，慢的那半只能跟着快的那半一起被重取。
 */
export function GET() {
  return statusRoute(getNowWatching);
}
