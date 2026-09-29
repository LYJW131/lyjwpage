
import type { LocalNowPlaying } from "@/lib/types";
import { type StoredHomePod, mirror } from "@shared/homepod-store";

const UNKNOWN_DURATION_STALE_MS = 12 * 60 * 60 * 1000;

/**
 * 曲目本该放完之后，还愿意再等 HA 多久。
 *
 * Home Assistant 是按状态变化推送的，不是每秒推。曲目实际放完到下一条推送
 * 送达之间总有间隔（自动化触发延迟、单曲循环、HA 那边压根没触发），这段时间
 * 里推算进度必然超过时长 —— 那说明的是「还没收到下一首」，不是「数据不可信」，
 * 不该把整条记录作废。真正该判定不可信的信号是 HA 长时间完全没动静。
 */
const SILENCE_GRACE_MS = 5 * 60 * 1000;

/**
 * 单曲循环时 HA 可能一直不推新事件（曲目没变、状态没变），所以「这首该放完了」
 * 这条判据整个不适用，只能靠一个长得多的静默窗口兜底。
 * 真停掉时 HomePod 的 state 会变，那是状态变化，HA 照样会推。
 */
const REPEAT_SILENCE_GRACE_MS = 30 * 60 * 1000;

/**
 * 停了或没标题的那份不参与选择。
 *
 * 单独拎出来是因为上报那条路上快照就在手上（刚规范化好的那份），不必等它落库
 * 再从存储读回来，但过滤口径必须和读取那条路一模一样。
 */
export function playableHomePod(stored: StoredHomePod | null): StoredHomePod | null {
  if (!stored || stored.music.state === "stopped" || !stored.music.title) return null;
  return stored;
}

/**
 * HomePod 上一份还在放的快照。
 *
 * 静默、放完由调用方按 receivedAt 现算（homePodVisibleAt），这里不按墙上的钟
 * 过滤 —— 过滤了就没法把存储里那份冻进缓存。
 */
export async function getHomePodSnapshot() {
  return playableHomePod(await mirror.get());
}

/**
 * 这份 HomePod 快照在 `now` 这一刻还算不算活的。
 *
 * Home Assistant 按状态变化推，不是每秒推。放完到下一条送达之间进度会超过
 * 时长，那是「还没收到下一首」，不是数据不可信。
 */
export function homePodVisibleAt(
  stored: { music: LocalNowPlaying; receivedAt: number },
  now: number,
) {
  return now <= homePodVisibleUntil(stored);
}

/**
 * 这份快照里的曲子按剩余时长该放完的那一刻。单曲循环、没有时长时说不出，返回 null。
 * Pulse 在 HA 再也没推来时，只把这一段认到这里，不把等待宽限算进去。
 */
export function homePodTrackEnd(stored: { music: LocalNowPlaying; receivedAt: number }): number | null {
  const { music, receivedAt } = stored;
  if (music.repeatOne || music.durationMs <= 0) return null;
  return receivedAt + Math.max(0, music.durationMs - music.positionMs);
}

/**
 * 这份快照最晚撑到哪一刻（含）：曲子该放完的那一刻再加上等待宽限。HA 只在状态变化时推，
 * 一首长歌、单曲循环、长时间暂停都可能很久只有这一份；Pulse 听歌道拿它当这次观测的
 * 有效期，见 shared/pulse-listening。
 */
export function homePodVisibleUntil(stored: { music: LocalNowPlaying; receivedAt: number }): number {
  const { music, receivedAt } = stored;
  if (music.repeatOne) return receivedAt + REPEAT_SILENCE_GRACE_MS;
  if (music.durationMs > 0) {
    const remaining = Math.max(0, music.durationMs - music.positionMs);
    return receivedAt + remaining + SILENCE_GRACE_MS;
  }
  return receivedAt + UNKNOWN_DURATION_STALE_MS;
}
export { type StoredHomePod } from "@shared/homepod-store";
