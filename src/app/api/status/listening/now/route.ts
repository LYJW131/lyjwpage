import { statusCachedRoute, statusEnvelope } from "@/lib/api";
import { pickNowListening } from "@/lib/now-listening";
import { readLiveness } from "@/lib/reporter-liveness";
import { getNowListeningSnapshot } from "@/lib/telemetry";

/**
 * 每次直读 Redis，不走 `'use cache'`。首屏 LCP 仍用 status-cache。
 *
 * 起因是两个来源分打两个源站：Mac 上报打 Vercel 那份（lyjw.me）、HomePod 打
 * EdgeOne 那份（lyjw131.com），而 `revalidateTag` 只失效收到上报的那一套 Next
 * 缓存 —— 另一边的快照会一直冻着上一首。那时两边共用 Redis，活读比跨源站同步
 * tag 便宜。
 *
 * **这个理由已经不成立了**：上报现在会原样转给对端，对端自己跑一遍同一个
 * handler、自己失效 `listening-now`（见 lib/ingest-relay），两边的快照都跟得上。
 * 保持活读只是还没改，不是还需要 —— 换回 `cachedNowListeningSnapshot` 能省掉
 * 每次轮询的那把 Redis 读。
 */
export function GET() {
  return statusCachedRoute(
    () => statusEnvelope(getNowListeningSnapshot),
    async (snapshot) => pickNowListening(snapshot, await readLiveness()),
  );
}
