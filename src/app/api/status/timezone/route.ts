import { statusCachedRoute } from "@/lib/api";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { cachedTimezone } from "@/lib/status-cache";

export function GET() {
  return statusCachedRoute(cachedTimezone, async (data) =>
    withPresence(data, await readLiveness()),
  );
}
