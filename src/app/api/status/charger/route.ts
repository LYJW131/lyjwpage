import { getChargerPayload } from "@/lib/anker";
import { sinceParam, statusRoute } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return statusRoute(() => getChargerPayload({ since: sinceParam(request) }));
}
