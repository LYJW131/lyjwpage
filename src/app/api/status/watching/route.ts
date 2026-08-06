import { statusRoute } from "@/lib/api";
import { getWatching } from "@/lib/emby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(() => getWatching({ limit: 8 }));
}
