import { getChargerPayload } from "@/lib/anker";
import { sinceParam, statusRoute } from "@/lib/api";

export function GET(request: Request) {
  return statusRoute(() => getChargerPayload({ since: sinceParam(request) }));
}
