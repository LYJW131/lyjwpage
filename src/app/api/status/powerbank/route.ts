import { statusCachedRoute } from "@/lib/api";
import { lastPushReceivedAt } from "@/lib/powerbank-store";
import { withPowerBankFreshness } from "@/lib/powerbank";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { cachedPowerBankSnapshot } from "@/lib/status-cache";

export function GET() {
  return statusCachedRoute(cachedPowerBankSnapshot, async (data) => {
    const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);
    // 电量曲线整份发：20 秒一个点、400 个点也才几 KB，不值得为它做增量游标。
    return withPowerBankFreshness(withPresence({ ...data, pushedAt }, live));
  });
}
