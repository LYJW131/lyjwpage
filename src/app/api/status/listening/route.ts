import { statusRoute } from "@/lib/api";
import { listeningStatus } from "@/lib/status-cache";

export function GET() {
  return statusRoute(listeningStatus);
}
