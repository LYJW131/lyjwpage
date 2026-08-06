import { getChargerStatus } from "@/lib/anker";
import { statusRoute } from "@/lib/api";

// 上游是 127.0.0.1 的本机服务，必须在 Node runtime 里转发
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(getChargerStatus);
}
