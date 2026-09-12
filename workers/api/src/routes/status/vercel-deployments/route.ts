import { statusRoute } from "@/lib/api";
import { vercelDeploymentsStatus } from "@/lib/status-sources";

export function GET() {
  return statusRoute(vercelDeploymentsStatus);
}
