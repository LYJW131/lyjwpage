/**
 * 跟听的对齐算术。hooks/use-listen-along 是 React 胶水，规则放这里才能单测。
 *
 * 进度条仍然用 track-position 推主人此刻的位置；跟听不能直接拿那个数去
 * seek —— 换歌时新曲目前几秒还在缓冲，主人的钟已经往前走了。把那个漂移当成
 * 起播点，开头就没了；过一会儿巡检再按主人当前位置追一次，中间又跳一截。
 */

/**
 * 排进队列时该从哪一秒起。
 *
 * 刚点「一起听」要对到主人此刻，否则半首歌才跟上会莫名其妙。
 * 已经在跟、只是换了曲子：用锚点上的 positionMs（换歌那一下几乎是 0），
 * **不要**加上缓冲期间墙上的钟又走掉的那一段。
 */
export function queueStartMs(input: {
  changingTrack: boolean;
  positionMs: number;
  hostPositionMs: number;
}): number {
  return Math.max(0, input.changingTrack ? input.positionMs : input.hostPositionMs);
}

/**
 * 新曲目真正出声时，主人已经超前了多少。
 *
 * 这段滞后是加载花掉的时间，不是缓冲卡顿。认下来之后巡检只追「又落后了
 * 多少」，不会把加载耗时一次性 seek 掉。超前按 0 —— 我们跑到主人前面不该
 * 变成一笔「负的允许落后」，否则后面算目标会把人往回拖。
 */
export function playbackLagMs(hostMs: number, localMs: number): number {
  return Math.max(0, hostMs - localMs);
}

/**
 * 出声之后认一笔滞后。
 *
 * seek 刚下完时 currentPlaybackTime 可能还是旧值，拿它算会把滞后估飞。
 * 本地进度还没落到起播点附近时，改用我们定下的那个起播点。
 */
export function captureLagMs(
  hostMs: number,
  localMs: number,
  intendedMs: number,
  thresholdMs: number,
): number {
  const origin = Math.abs(localMs - intendedMs) <= thresholdMs ? localMs : intendedMs;
  return playbackLagMs(hostMs, origin);
}

/** 巡检要对齐的位置：主人此刻减去已经认下的加载滞后 */
export function followTargetMs(hostMs: number, lagMs: number): number {
  return Math.max(0, hostMs - lagMs);
}

export function needsResync(localMs: number, targetMs: number, thresholdMs: number): boolean {
  return Math.abs(localMs - targetMs) > thresholdMs;
}

/**
 * 正常下一首要对齐吗。
 *
 * 看锚点上的 positionMs，不看墙上的钟：切歌加载那几秒主人已经往前走了，
 * 那不是他拖了进度。锚点几乎在 0 就直接切、从开头走；已经播进去超过
 * 阈值（跳到歌中间、上一首其实没切干净）才 seek。
 */
export function shouldSeekAfterTrackChange(
  anchorPositionMs: number,
  thresholdMs: number,
): boolean {
  return anchorPositionMs > thresholdMs;
}

/**
 * 主人是不是拖了进度（或换了一个差很远的锚点）。
 *
 * 跟听位置加上认下的滞后，应该贴着主人。对不上就是他seek了，该跟过去并
 * 清掉滞后；对得上就是续播，保持原滞后，不要一恢复播放就把开头再跳掉一次。
 */
export function isHostSeek(localMs: number, lagMs: number, hostMs: number, thresholdMs: number): boolean {
  return Math.abs(localMs + lagMs - hostMs) > thresholdMs;
}
