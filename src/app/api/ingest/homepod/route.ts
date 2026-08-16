import { ingestRoute } from "@/lib/api";
import { normalizeHomePodEvent, writeHomePodEvent } from "@/lib/homepod-store";
import { fanout, NOW_LISTENING_TAG } from "@/lib/live-events";
import { homePodListeningEvent } from "@/lib/telemetry";

/** Home Assistant pushes HomePod track and playback-state changes here. */
export async function POST(request: Request) {
  return ingestRoute(request, async (body) => {
    const stored = normalizeHomePodEvent(body);
    // HomePod 只影响播放，不碰前台应用。
    // 落库和推送同时发车 —— 推的那份就是手上这一份，不必等它写进 Redis，
    // 先后为什么可以这样见 lib/live-events 的 fanout
    await fanout({
      writes: [writeHomePodEvent(stored)],
      events: [homePodListeningEvent(stored)],
      urgentTags: [NOW_LISTENING_TAG],
    });
    return { source: stored.music.source, state: stored.music.state };
  });
}
