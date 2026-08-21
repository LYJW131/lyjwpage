import { statusRoute } from "@/lib/api";
import { vibeCodingYearStatus } from "@/lib/status-cache";

export function GET() {
  return statusRoute(vibeCodingYearStatus);
}
