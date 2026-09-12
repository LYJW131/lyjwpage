import { statusRoute } from "@/lib/api";
import { cloudflareWorkersStatus } from "@/lib/status-sources";

export function GET() {
  return statusRoute(cloudflareWorkersStatus);
}
