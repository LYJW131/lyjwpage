import { statusRoute } from "@/lib/api";
import { githubChartStatus } from "@/lib/status-cache";

export function GET() {
  return statusRoute(githubChartStatus);
}
