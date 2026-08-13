import { sliceChargerHistory, withChargerFreshness } from "@/lib/anker";
import { sinceParam, statusCachedRoute } from "@/lib/api";
import { lastPushReceivedAt } from "@/lib/charger-store";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { cachedChargerSnapshot } from "@/lib/status-cache";

export function GET(request: Request) {
  const since = sinceParam(request);
  return statusCachedRoute(cachedChargerSnapshot, async (data) => {
    const [pushedAt, live] = await Promise.all([lastPushReceivedAt(), readLiveness()]);
    return withChargerFreshness(
      withPresence({ ...sliceChargerHistory(data, since), pushedAt }, live),
    );
  });
}
