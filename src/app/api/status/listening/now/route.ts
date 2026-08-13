import { statusCachedRoute } from "@/lib/api";
import { pickNowListening } from "@/lib/now-listening";
import { readLiveness } from "@/lib/reporter-liveness";
import { cachedNowListeningSnapshot } from "@/lib/status-cache";

export function GET() {
  return statusCachedRoute(cachedNowListeningSnapshot, async (snapshot) =>
    pickNowListening(snapshot, await readLiveness()),
  );
}
