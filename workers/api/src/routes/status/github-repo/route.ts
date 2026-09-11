import { statusRoute } from "@/lib/api";
import { githubRepoStatus } from "@/lib/status-sources";

export function GET() {
  // 统计变化慢，TTL 在取数层（30 分钟）；这里不切片，整份一次发完。
  return statusRoute(githubRepoStatus);
}
