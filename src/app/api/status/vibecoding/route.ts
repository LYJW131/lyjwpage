import { sinceParam, statusRoute } from "@/lib/api";
import { getVibeCodingPayload } from "@/lib/vibecoding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return statusRoute(() => getVibeCodingPayload({ since: sinceParam(request) }));
}
