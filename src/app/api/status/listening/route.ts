import { statusRoute } from "@/lib/api";
import { refreshRecentlyPlayed } from "@/lib/apple-music-recent";
import { listeningStatus } from "@/lib/status-cache";

/**
 * 顺手刷新一遍列表。整块跑在响应之后，见 refreshRecentlyPlayed 的注释 ——
 * 这次响应给的仍是手上那份，新拉到的由推送和缓存失效带给下一眼。
 *
 * 这条端点是 10 分钟一轮的慢档，主力刷新点在隔壁 `listening/now`（60 秒一轮）。
 * 挂在两边是为了「只有这张卡的列表被读到」的那些时候 —— 比如实时那份还没轮到、
 * 或者哪天有别的调用方只读列表 —— 也能把闸门推一格。真正拉不拉由 TTL 决定，
 * 挂两处不等于多拉。
 */
export async function GET() {
  const refreshed = refreshRecentlyPlayed();
  const response = await statusRoute(listeningStatus);
  await refreshed;
  return response;
}
