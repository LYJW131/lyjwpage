import { statusRoute } from "@/lib/api";
import { getNowPlaying, getRecentlyPlayed } from "@/lib/apple-music";
import type { ListeningPayload } from "@/lib/types";

// 需要 node:fs 与 ES256 签名，不能跑在 Edge
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute<ListeningPayload>(async () => {
    // 两者共用同一份缓存的列表，不会多打一次上游
    const [items, nowPlaying] = await Promise.all([
      getRecentlyPlayed({ limit: 10, artworkSize: 300 }),
      getNowPlaying(),
    ]);
    return { items, nowPlaying };
  });
}
