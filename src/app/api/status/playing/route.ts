import { limitParam, statusRoute } from "@/lib/api";
import { slicePlaying } from "@/lib/playstation";
import { playingStatus } from "@/lib/status-cache";

/**
 * PlayStation 最近游玩列表。`?limit=` 只要最近这几条（首屏那份，见 lib/paths 的
 * PLAYING_FIRST_PATH），不带这个参数才是全量 —— 切片在每请求的出口做，缓存里
 * 冻的是全量，理由见 lib/playstation 的 slicePlaying。
 */
export function GET(request: Request) {
  const limit = limitParam(request);
  return statusRoute(playingStatus, (data) =>
    limit == null ? data : slicePlaying(data, limit),
  );
}
