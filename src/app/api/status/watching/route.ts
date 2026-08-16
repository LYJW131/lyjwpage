import { statusRoute } from "@/lib/api";
import { watchingStatus } from "@/lib/status-cache";

/**
 * 条数用 getWatching 自己的默认值，这里不再重复写一遍 —— 推送那条也调它，
 * 两处给的条数一旦不一样，推来的和轮询取回的就是两份长短不同的列表。
 */
export function GET() {
  return statusRoute(watchingStatus);
}
