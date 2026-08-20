import { fromParam, statusRoute, statusSource } from "@/lib/api";
import { cachedVibeCodingYear } from "@/lib/status-cache";
import { getVibeCodingYearChunk } from "@/lib/vibecoding-year-store";

export function GET(request: Request) {
  const from = fromParam(request);
  return statusRoute(
    statusSource(
      () => cachedVibeCodingYear(from),
      () => getVibeCodingYearChunk(from),
    ),
  );
}
