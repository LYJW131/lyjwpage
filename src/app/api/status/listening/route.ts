import { statusRoute } from "@/lib/api";
import { getNowPlaying, getRecentlyPlayed } from "@/lib/apple-music";
import type { ListeningPayload } from "@/lib/types";

// ioredis 是 TCP 客户端，Edge 上没有 net 模块。凭据早就不在这边签了
// （.p8 留在 Mac 上，见 lib/apple-music-credentials），从前那条理由已经不成立
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return statusRoute<ListeningPayload>(async () => {
    // 两者共用同一份缓存的列表，不会多打一次上游
    const [items, nowPlaying] = await Promise.all([
      // 封面 URL 原样透传，尺寸由前端按各自位置填 —— 服务端不知道谁要多大
      getRecentlyPlayed({ limit: 10 }),
      getNowPlaying(),
    ]);
    return { items, nowPlaying };
  });
}
