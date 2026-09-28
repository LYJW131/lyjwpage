import { mirror } from "@shared/homepod-store";
import { liveTrack } from "@/lib/home-layout";
import { NOW_LISTENING_TAG } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { homePodListening } from "@api/stores/telemetry";
import type { PreparedHomePodEvent } from "@shared/ingest/homepod";

/**
 * Home Assistant 推来的 HomePod 曲目和播放状态变化，状态核心那一半。
 *
 * HomePod 只影响播放，不碰前台应用。提交时捕获这一封对应的播放输入；确认落库后，
 * 普通 Worker 再做 Apple 目录补充与推送，不从后台重读可能已被下一封替换的状态。
 * 报文收敛在上报入口，见 shared/ingest/homepod.ts。
 */
export async function commitPreparedHomePodEvent({ stored }: PreparedHomePodEvent) {
  const previous = await mirror.get();
  // 首屏只在「有没有在放」翻面时失效：换歌、暂停续播只换 hero 里的内容，见 lib/home-layout
  const layoutChanged = (liveTrack(previous?.music) != null) !== (liveTrack(stored.music) != null);
  const listening = homePodListening(stored);
  await fanout({
    writes: [mirror.put(stored), listening.pulse],
    listening: [listening.effect],
    tags: layoutChanged ? [NOW_LISTENING_TAG] : [],
  });
  return { source: stored.music.source, state: stored.music.state };
}
