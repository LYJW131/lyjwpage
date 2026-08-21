/**
 * 跟听的对齐算术。hooks/use-listen-along 是 React 胶水，规则放这里才能单测。
 *
 * 进度条仍然用 track-position 推主人此刻的位置；跟听不能直接拿那个数去
 * seek —— 换歌时新曲目前几秒还在缓冲，主人的钟已经往前走了。把那个漂移当成
 * 起播点，开头就没了；过一会儿巡检再按主人当前位置追一次，中间又跳一截。
 */

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

/** 巡检要对齐的位置：主人此刻减去已经认下的加载滞后 */
export function followTargetMs(hostMs: number, lagMs: number): number {
  return Math.max(0, hostMs - lagMs);
}

/**
 * 环上的距离：单曲循环里结尾和开头只差一拍。
 *
 * 主人的钟按模运算绕回 0 时，本地可能还停在结尾附近 —— 直线距离是一整首，
 * 环上距离才是真实偏差。按直线算会触发一次没必要的 seek，还正好撞上
 * MusicKit 自己的循环重启，叠出 AbortError 弹窗。总长未知退回直线。
 */
export function loopDistanceMs(aMs: number, bMs: number, loopDurationMs: number): number {
  const straight = Math.abs(aMs - bMs);
  if (loopDurationMs <= 0) return straight;
  return Math.min(straight, Math.abs(loopDurationMs - straight));
}

export function needsResync(
  localMs: number,
  targetMs: number,
  thresholdMs: number,
  loopDurationMs = 0,
): boolean {
  return loopDistanceMs(localMs, targetMs, loopDurationMs) > thresholdMs;
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
 * 单曲循环时传 loopDurationMs，绕回开头不算拖进度。
 */
export function isHostSeek(
  localMs: number,
  lagMs: number,
  hostMs: number,
  thresholdMs: number,
  loopDurationMs = 0,
): boolean {
  return loopDistanceMs(localMs + lagMs, hostMs, loopDurationMs) > thresholdMs;
}

/**
 * 主人是不是把这首拖回去重听了。
 *
 * 播放器已经挪到下一首、主人锚点还指着这首时有两种可能：锚点钉在歌尾是
 * 切歌前的残影，不该拉回去；离结尾还很远才是真的回去重听。总长未知不猜。
 */
export function hostRewoundIntoTrack(
  hostMs: number,
  durationMs: number,
  tailMs: number,
): boolean {
  return durationMs > 0 && durationMs - hostMs > tailMs;
}
