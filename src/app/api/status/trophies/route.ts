import { statusRoute, titleIdsParam } from "@/lib/api";
import { trophiesStatus } from "@/lib/status-cache";
import { sliceTrophies } from "@/lib/trophies";

/**
 * PlayStation 奖杯目录。`?titleids=` 只要这几款（键的拼法见 lib/paths 的
 * trophiesTilePath），不带这个参数才是整份 —— 切片在每请求的出口做，缓存里
 * 冻的是整份，理由见 lib/trophies 的 sliceTrophies。
 */
export function GET(request: Request) {
  const titleIds = titleIdsParam(request);
  return statusRoute(trophiesStatus, (data) =>
    titleIds == null ? data : sliceTrophies(data, titleIds),
  );
}
