import { statusRoute } from "@/lib/api";
import { getWatching } from "@/lib/emby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 条数用 getWatching 自己的默认值，这里不再重复写一遍 —— 推送那条也调它，
 * 两处给的条数一旦不一样，推来的和轮询取回的就是两份长短不同的列表。
 */
export function GET() {
  return statusRoute(() => getWatching());
}
