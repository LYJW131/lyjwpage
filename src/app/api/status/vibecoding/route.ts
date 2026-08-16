import { sinceParam, statusRoute } from "@/lib/api";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { vibeCodingStatus } from "@/lib/status-cache";
import { sliceVibeCodingActivity } from "@/lib/vibecoding";

export function GET(request: Request) {
  const since = sinceParam(request);
  return statusRoute(vibeCodingStatus, async (data) =>
    withPresence(sliceVibeCodingActivity(data, since), await readLiveness()),
  );
}
