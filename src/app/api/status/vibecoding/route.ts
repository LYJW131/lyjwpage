import { sinceParam, statusRoute } from "@/lib/api";
import { getVibeCodingPayload } from "@/lib/vibecoding";

export function GET(request: Request) {
  return statusRoute(() => getVibeCodingPayload({ since: sinceParam(request) }));
}
