import { homePodTrackEnd, homePodVisibleAt, homePodVisibleUntil } from "@/lib/homepod-store";
import { offlineByLiveness, type Liveness } from "@/lib/reporter-liveness";
import type { ListeningItem, LocalNowPlaying } from "@/lib/types";
import { PULSE_STATE_HOLD_MS, pulseText, type ListeningFacts, type ObservationHold } from "@shared/pulse-timeline";

/**
 * Listening 道此刻的一次观测：谁在放、放的什么、在放还是暂停，以及这次观测能撑到几点。
 *
 * 和首页 Hero 的仲裁（pickNowListening）不同，这里不套 10 秒暂停宽限：Hero 要决定
 * 「现在给谁腾位置」，时间线要记的是事实 —— 音乐 App 停在暂停就是暂停。顺序是
 * Mac 在放 → HomePod 在放 → Mac 暂停 → HomePod 暂停 → 空闲。
 *
 * 有效期跟着来源走：Mac 每 30 秒一封心跳，给固定的 10 分钟；HomePod 只在状态变化时
 * 由 HA 推一次，一首二十分钟的歌、单曲循环、长暂停都可能只有这一份，所以按那份快照
 * 自己的可见期限（剩余时长加宽限，见 homePodVisibleUntil）判断还开不开着。HA 再也没
 * 推来时，这一段只认到曲子按剩余时长该放完的那一刻（homePodTrackEnd），宽限不算进事实；
 * Mac 断了则只认到最后一次心跳。
 *
 * 返回 null 表示这一刻看不见：Mac 离线（或关了 appleMusic 模块）而 HomePod 也没有
 * 仍然有效的快照。那段是未知，不是空闲。
 */
export function listeningObservation(
  input: {
    /** Mac 工作副本里的播放；关了 appleMusic 模块时 `macObserved` 为 false */
    mac: LocalNowPlaying | null;
    macObserved: boolean;
    homePod: { music: LocalNowPlaying; receivedAt: number } | null;
  },
  live: Liveness,
  now: number,
): { facts: ListeningFacts; hold: ObservationHold } | null {
  const macVisible = input.macObserved && !offlineByLiveness(live, now);
  const mac = macVisible && input.mac?.title ? input.mac : null;
  const homePod = input.homePod && input.homePod.music.title && homePodVisibleAt(input.homePod, now) ? input.homePod : null;
  const macHold: ObservationHold = { until: now + PULSE_STATE_HOLD_MS };
  const homePodHold = (stored: { music: LocalNowPlaying; receivedAt: number }): ObservationHold =>
    ({ until: homePodVisibleUntil(stored), endsBy: homePodTrackEnd(stored) });
  if (mac?.state === "playing") return { facts: playingFacts(mac), hold: macHold };
  if (homePod?.music.state === "playing") return { facts: playingFacts(homePod.music), hold: homePodHold(homePod) };
  if (mac?.state === "paused") return { facts: playingFacts(mac), hold: macHold };
  if (homePod?.music.state === "paused") return { facts: playingFacts(homePod.music), hold: homePodHold(homePod) };
  if (!macVisible && !homePod) return null;
  const idle: ListeningFacts = { state: "idle", source: null, title: null, artist: null, album: null, trackId: null };
  // Mac 看不见时，这份空闲只有 HomePod 那份快照在担保
  return { facts: idle, hold: macVisible || !homePod ? macHold : homePodHold(homePod) };
}

function playingFacts(music: LocalNowPlaying): ListeningFacts {
  return {
    state: music.state === "playing" ? "playing" : "paused",
    source: music.source === "homepod" ? "homepod" : "mac",
    title: pulseText(music.title),
    artist: pulseText(music.artist),
    album: pulseText(music.album),
    trackId: pulseText(music.trackId, 80),
  };
}

/**
 * 一次「最近在听」列表变动：没有时刻的播放痕迹。
 *
 * Apple 这份列表按最后播放时间倒序，却不给时刻，所以能断言的只有区间：播放发生在
 * 上一轮成功刷新 `since` 和看见变化的这一刻 `t` 之间，`(since, t]`。时间线如实画成
 * 一段「不确定」的区间，不当成此刻在放。条目是专辑 / 歌单 / 电台，不是单曲。
 */
export type ListeningTrace = {
  since: number;
  t: number;
  /** 新排到前面的那一项：专辑 / 歌单名 */
  title: string | null;
  /** 专辑取艺人，歌单取策展人 */
  artist: string | null;
  /** Apple Music 目录里那一项的 id */
  itemId: string | null;
};
export const LISTENING_TRACE_CAP = 2000;

/**
 * 只比 id 和顺序。
 *
 * 不能拿整份 JSON 比（那是 prepareRecentlyPlayed 里 `changed` 的口径，它要管的是
 * 推不推给浏览器）：自建歌单封面是 12 小时一换的预签名地址，时长又只算第一项，
 * 两者都会变，而两者都不是「又放了什么」。
 */
export function playbackSignature(items: ListeningItem[]): string {
  return items.map((item) => item.id).join("\n");
}

/**
 * 两轮列表之间有没有发生播放。
 *
 * 没有上一份就返回 null：第一次拉回来的列表整份都是「新」的，却不代表刚刚在放，
 * 要等下一份列表与这份基线比较，才能判断两轮之间的变化。
 */
export function listeningTrace(
  previous: { items: ListeningItem[]; fetchedAt: number } | null,
  next: { items: ListeningItem[]; fetchedAt: number },
): ListeningTrace | null {
  if (!previous || next.fetchedAt <= previous.fetchedAt) return null;
  if (playbackSignature(previous.items) === playbackSignature(next.items)) return null;
  const known = new Set(previous.items.map((item) => item.id));
  // 没有新条目就是老专辑被重放顶到了前面，那时最前面那项就是它。
  const named = next.items.find((item) => !known.has(item.id)) ?? next.items[0] ?? null;
  return {
    since: previous.fetchedAt,
    t: next.fetchedAt,
    title: pulseText(named?.title),
    artist: pulseText(named?.artist),
    itemId: pulseText(named?.id, 80),
  };
}

/** 脏行丢掉，不因为一条坏 JSON 废掉整串证据。 */
export function parseListeningTrace(raw: string): ListeningTrace | null {
  try {
    const row = JSON.parse(raw) as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return null;
    const { t, since } = row;
    if (typeof t !== "number" || !Number.isSafeInteger(t) || typeof since !== "number" || !Number.isSafeInteger(since) || since >= t) return null;
    return { since, t, title: pulseText(row.title), artist: pulseText(row.artist), itemId: pulseText(row.itemId, 80) };
  } catch {
    return null;
  }
}
