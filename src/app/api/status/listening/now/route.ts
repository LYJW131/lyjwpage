import { statusCachedRoute, statusEnvelope } from "@/lib/api";
import { pickNowListening } from "@/lib/now-listening";
import { readLiveness } from "@/lib/reporter-liveness";
import { getNowListeningSnapshot } from "@/lib/telemetry";

/**
 * 每次直读 Redis，不走 `'use cache'`。
 *
 * Mac 上报打 lyjw.me，HomePod 打国内 EdgeOne，两边共用 Redis。`revalidateTag`
 * 只失效发出上报的那一套 Next 缓存，另一边的快照会一直冻着上一首。候选本身
 * 就是两把 Redis 键，活读比跨源站同步 tag 便宜。首屏 LCP 仍用 status-cache。
 */
export function GET() {
  return statusCachedRoute(
    () => statusEnvelope(getNowListeningSnapshot),
    async (snapshot) => pickNowListening(snapshot, await readLiveness()),
  );
}
