import { statusCachedRoute } from "@/lib/api";
import { cachedListening } from "@/lib/status-cache";

export function GET() {
  return statusCachedRoute(cachedListening);
}
