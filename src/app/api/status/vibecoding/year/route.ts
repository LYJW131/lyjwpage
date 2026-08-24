import { sinceDateParam, statusRoute } from "@/lib/api";
import { vibeCodingYearStatus } from "@/lib/status-cache";
import { sliceVibeCodingYear } from "@/lib/vibecoding-year";

export function GET(request: Request) {
  const since = sinceDateParam(request);
  return statusRoute(vibeCodingYearStatus, (data) => sliceVibeCodingYear(data, since));
}
