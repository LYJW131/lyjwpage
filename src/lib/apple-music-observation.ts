/**
 * 「此刻在不在听」那个推断所依赖的观测，纯函数那一半。
 *
 * Apple 没有可查的当前播放接口，也不给播放时刻，只能看最近播放列表里排第一的
 * 那项**什么时候变成第一的**。所以这份状态要跨请求留着（存哪见
 * lib/apple-music-store），而「这一眼该怎么改它」是纯粹的判断，拆出来钉住。
 */

export type Observation = {
  /** 上一次看见排在最前的那一项 */
  id: string;
  /** 观测到它换上来的时刻；不知道就是 null */
  switchedAt: number | null;
  /** 上一次看这一眼的时刻，用来判断观测断没断 */
  observedAt: number;
};

/**
 * 看一眼，得出新的观测状态。
 *
 * `switchedAt` 只有在真的看见「它从别的东西换成了它」、而且**上一次观测离现在不
 * 太久**时才有值。两个条件缺一不可：
 *
 * - 第一次看见（没有上一次）时，此刻只是我们开始看的时刻，不是它开始播的时刻；
 * - 隔了很久才又看一眼时，我们只知道「这段时间里的某一刻换的」，不知道是哪一刻。
 *
 * 两种情况都是 null，也就是「不知道」。把此刻顶上去会凭空造出一整段「播放中」，
 * 而这个推断只该在有把握时说话 —— 宁可漏报，不可误报。站点没人看的那段时间里
 * 没有任何观测，所以「访客到达前就已经开始的那次播放不亮 inferred」是常态，
 * 不是故障。
 *
 * 同一项还在最前时**沿用**上次的 `switchedAt`，哪怕中间断过一截：一直排第一
 * 说明这期间没换过东西，那个时刻仍然是我们知道的最后一次切换。它会不会被判成
 * 「还在听」交给时长去比 —— 停下来但没换过的那种情况，无论观测多连续都分辨
 * 不出来，那是这个推断本身的性质。
 */
export function nextObservation(
  previous: Observation | null,
  id: string,
  now: number,
  /** 两次观测隔多久就当断了 */
  gapMs: number,
): Observation {
  const continuous = previous != null && now - previous.observedAt <= gapMs;
  const switchedAt = previous?.id === id ? previous.switchedAt : continuous ? now : null;
  return { id, switchedAt, observedAt: now };
}
