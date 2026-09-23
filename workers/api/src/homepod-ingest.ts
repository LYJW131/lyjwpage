import { mirror } from "@shared/homepod-store";
import { liveTrack } from "@/lib/home-layout";
import { NOW_LISTENING_TAG } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { normalizeHomePodEvent, writeHomePodEvent } from "@api/stores/homepod-store";
import { homePodListening } from "@api/stores/telemetry";
import type { StoredHomePod } from "@shared/homepod-store";

/**
 * Home Assistant 推来的 HomePod 曲目和播放状态变化。
 *
 * HomePod 只影响播放，不碰前台应用。提交时捕获这一封对应的播放输入；确认落库后，
 * 普通 Worker 再做 Apple 目录补充与推送，不从后台重读可能已被下一封替换的状态。
 *
 * 和别的来源一样是一个 `record*`，app/api/ingest/homepod 和 workers/api 各调一次；
 * 从前这段逻辑写在路由文件里，Worker 一来就得抄第二份。
 */
export async function recordHomePodEvent(body: unknown) {
  return commitPreparedHomePodEvent(prepareHomePodEvent(body));
}

export type PreparedHomePodEvent = { source: "homepod"; stored: StoredHomePod };

export function prepareHomePodEvent(body: unknown, receivedAt = Date.now()): PreparedHomePodEvent {
  return { source: "homepod", stored: normalizeHomePodEvent(body, receivedAt) };
}

export async function commitPreparedHomePodEvent({ stored }: PreparedHomePodEvent) {
  const previous = await mirror.get();
  // 首屏只在「有没有在放」翻面时失效：换歌、暂停续播只换 hero 里的内容，见 lib/home-layout
  const layoutChanged = (liveTrack(previous?.music) != null) !== (liveTrack(stored.music) != null);
  const listening = homePodListening(stored);
  await fanout({
    writes: [writeHomePodEvent(stored), listening.pulse],
    listening: [listening.effect],
    tags: layoutChanged ? [NOW_LISTENING_TAG] : [],
  });
  return { source: stored.music.source, state: stored.music.state };
}
