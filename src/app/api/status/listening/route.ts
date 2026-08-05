import { statusRoute } from "@/lib/api";
import { getRecentlyPlayed } from "@/lib/apple-music";

// 需要 node:fs 与 ES256 签名，不能跑在 Edge
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute(() => getRecentlyPlayed({ limit: 10, artworkSize: 300 }));
}
