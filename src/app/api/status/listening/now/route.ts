import { statusCachedRoute } from "@/lib/api";
import { pickNowListening } from "@/lib/now-listening";
import { readLiveness } from "@/lib/reporter-liveness";
import { cachedNowListeningSnapshot } from "@/lib/status-cache";

/**
 * 两个候选走 `'use cache'`，Hero 在 overlay 里现选 —— 和另外七条状态端点同一套。
 *
 * 这条从前每次直读 Redis：Mac 上报打 Vercel 那份（lyjw.me）、HomePod 打 EdgeOne
 * 那份（lyjw131.com），而 `revalidateTag` 只失效收到上报的那一套 Next 缓存，另一边
 * 的快照会一直冻着上一首。上报现在会原样转给对端、对端自己失效 `listening-now`
 * （见 lib/ingest-relay），两边的快照都跟得上，那个理由就没了 —— 换回缓存省掉的是
 * 每次轮询的三四趟 Redis（遥测状态、HomePod 快照、两次曲目链接），overlay 里只剩
 * 存活那一把小 key。
 *
 * **能冻的前提是所有跟着墙上的钟变的东西都不在快照里**，这一点各处早就对齐了：
 * 暂停宽限、HomePod 的静默/放完判定（homePodVisibleAt）、上报器存活全在
 * pickNowListening 里按 `now` 现算，`getHomePodSnapshot` 也刻意不按时间过滤。
 *
 * 换歌走 expireStatusImmediately（`{ expire: 0 }`），没有 stale-while-revalidate
 * 的宽限期，所以下一次请求拿到的一定是新的那首，不会先给旧值再后台重建。
 */
export function GET() {
  return statusCachedRoute(cachedNowListeningSnapshot, async (snapshot) =>
    pickNowListening(snapshot, await readLiveness()),
  );
}
