import { statusRoute } from "@/lib/api";
import { pickNowListening } from "@/lib/now-listening";
import { readLiveness } from "@/lib/reporter-liveness";
import { nowListeningStatus } from "@/lib/status-cache";

/**
 * 两个候选按 STATUS_CACHE 决定冻不冻，Hero 在 overlay 里现选 —— 和另外七条状态
 * 端点同一套。
 *
 * **能冻的前提是所有跟着墙上的钟变的东西都不在快照里**，这一点各处早就对齐了：
 * 暂停宽限、HomePod 的静默/放完判定（homePodVisibleAt）、上报器存活全在
 * pickNowListening 里按 `now` 现算，`getHomePodSnapshot` 也刻意不按时间过滤。
 *
 * 换歌走 expireStatusImmediately（`{ expire: 0 }`），没有 stale-while-revalidate
 * 的宽限期，所以下一次请求拿到的一定是新的那首，不会先给旧值再后台重建 —— 但那
 * 只在本实例成立，国内那份因此把 STATUS_CACHE 关掉直读 Redis，见 lib/api。
 */
export function GET() {
  return statusRoute(nowListeningStatus, async (snapshot) =>
    pickNowListening(snapshot, await readLiveness()),
  );
}
