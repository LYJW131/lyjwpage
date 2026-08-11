import { statusRoute } from "@/lib/api";
import { getRecentlyPlayed } from "@/lib/apple-music-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 「最近在听」。
 *
 * 一次 Redis 读就完事 —— 列表和「此刻在不在听」的推断都由
 * reporters/apple-music-reporter 算好推来，见 lib/apple-music-store。
 * 从前这里要现打 Apple 的目录接口，一次请求十几趟 Redis 加一次上游往返。
 */
export function GET() {
  return statusRoute(getRecentlyPlayed);
}
