import { statusCachedRoute } from "@/lib/api";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { cachedDesktop } from "@/lib/status-cache";

export function GET() {
  return statusCachedRoute(cachedDesktop, async (data) =>
    withPresence(data, await readLiveness()),
  );
}
