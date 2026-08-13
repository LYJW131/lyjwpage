import { sinceParam, statusCachedRoute } from "@/lib/api";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { cachedVibeCoding } from "@/lib/status-cache";
import { sliceVibeCodingActivity } from "@/lib/vibecoding";

export function GET(request: Request) {
  const since = sinceParam(request);
  return statusCachedRoute(cachedVibeCoding, async (data) =>
    withPresence(sliceVibeCodingActivity(data, since), await readLiveness()),
  );
}
