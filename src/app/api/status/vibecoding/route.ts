import { statusRoute } from "@/lib/api";
import { getVibeCodingPayload } from "@/lib/vibecoding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(getVibeCodingPayload);
}
