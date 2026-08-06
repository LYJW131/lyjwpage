import { getChargerPayload } from "@/lib/anker";
import { statusRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(getChargerPayload);
}
