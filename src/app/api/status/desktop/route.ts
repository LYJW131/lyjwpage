import { statusRoute } from "@/lib/api";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import { desktopStatus } from "@/lib/status-cache";

export function GET() {
  return statusRoute(desktopStatus, async (data) =>
    withPresence(data, await readLiveness()),
  );
}
