import type { LocalNowPlaying } from "@/lib/types";

/**
 * 推算进度真正用得上的那几个字段。
 *
 * 收窄成这个而不是整个 LocalNowPlaying：跟听那侧的 effect 依赖列表里放的是拆开
 * 的原始值（对象每轮换引用会让对齐白跑一遍），手上没有完整的那一个。
 * LocalNowPlaying 结构上就满足它，进度条那侧原样传即可。
 */
export type PlaybackAnchor = Pick<
  LocalNowPlaying,
  "state" | "observedAt" | "positionMs" | "durationMs" | "repeatOne"
>;

/**
 * 从锚点推算此刻的播放进度。
 *
 * 上报器只在换歌和播放状态变化时推锚点，播放中的进度由前端按 observedAt 往前
 * 推。**进度条和「一起听」必须用同一份算法** —— 两边各写一遍的话，页面上画到
 * 1:23 而访客耳朵里在放 1:19，还没法一眼看出是谁错了。
 *
 * `now` 用的是浏览器的钟，`observedAt` 是设备的钟，这一减跨了两个时钟。两边都
 * 对着 NTP，实测偏差在亚秒级，可以忍；`max(0, …)` 兜住设备钟略快于浏览器钟的
 * 情况，不让进度往回走。真要较真得由源站转述时刻，见 lib/now-listening 里
 * expiresInMs 那段 —— 那个值就是为了不让客户端自己算才由服务端给的。
 *
 * 首帧 now 传 0（见 useMountedAt）时 drift 恰好是 0，不用另开分支。
 */
export function trackPositionMs(track: PlaybackAnchor, now: number): number {
  const drift = track.state === "playing" ? Math.max(0, now - track.observedAt) : 0;
  const elapsed = track.positionMs + drift;
  if (track.durationMs <= 0) return elapsed;
  // 单曲循环时上游可能一直不推新锚点（曲目没变、状态没变），进度该绕回开头而
  // 不是钉在 100%；不循环时超出就 clamp，等下一条锚点纠正
  return track.repeatOne ? elapsed % track.durationMs : Math.min(track.durationMs, elapsed);
}
