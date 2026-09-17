import { readActivityHistory } from "@/lib/activity-history";
import { sinceParam, statusRoute } from "@/lib/api";

export function GET(request: Request) {
  const since = sinceParam(request);
  return statusRoute(() => readActivityHistory(since));
}
