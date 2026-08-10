/**
 * 上报器还活不活着 —— 全站唯一的判据。
 *
 * 单独成一个模块，是为了让 anker / vibecoding / telemetry 都能读它而不产生
 * 循环依赖（telemetry 本来就要引 anker，反过来再引就成环了）。
 *
 * 从前这件事在三个地方各判一次，阈值还都不一样：desktop/music 45 秒、
 * charger 90 秒、vibe_coding 15 分钟。同一台 Mac 掉线时三张卡会先后错开变灰，
 * 最长差十几分钟。存活是一个事实，不该有三个答案。
 *
 * 注意这里只回答「上报器在不在」。各模块「自己的数据够不够新」是另一回事，
 * 仍然由各自判断，两者取或 —— 比如 CodexBar 十几分钟没刷新，即使 Mac 在线，
 * 那张卡也该显示为陈旧。
 */

/** 上报器每 30 秒心跳一次，留出定时器和网络抖动的余量 */
const HEARTBEAT_WINDOW_MS = 45_000;

type Liveness = {
  /** 最近一次收到任何上报或心跳的时刻 */
  lastSeenAt: number;
  /** 上报器亲口声明的离线，只在优雅离开（退出 / 睡眠）时为真 */
  declaredOffline: boolean;
};

const store = globalThis as typeof globalThis & {
  __lyjwReporterLiveness?: Liveness;
};
const liveness = (store.__lyjwReporterLiveness ??= {
  lastSeenAt: 0,
  declaredOffline: false,
});

export function markReporterSeen(at = Date.now()) {
  liveness.lastSeenAt = at;
}

export function reporterLastSeenAt() {
  return liveness.lastSeenAt;
}

/** 返回声明值是否发生了翻转，调用方据此决定要不要往 SSE 推 */
export function declareReporterOffline(offline: boolean) {
  const flipped = liveness.declaredOffline !== offline;
  liveness.declaredOffline = offline;
  return flipped;
}

export function reporterOffline() {
  // 亲口说走了就直接算离线，不用等心跳窗口
  if (liveness.declaredOffline) return true;
  return !liveness.lastSeenAt || Date.now() - liveness.lastSeenAt > HEARTBEAT_WINDOW_MS;
}

/**
 * 整份存活记录的读写，给持久化用。
 *
 * 存活得跟着遥测状态一起落 Redis：只存状态不存存活的话，进程重启后页面会拿着
 * 上一次的前台应用、却认为上报器从没出现过，两者对不上。`declaredOffline` 尤其
 * 要存 —— 上报器睡前那声「我走了」不该因为站点重启就丢掉。
 */
export function livenessSnapshot(): Liveness {
  return { ...liveness };
}

export function restoreLiveness(next: Partial<Liveness>) {
  if (next.lastSeenAt != null) liveness.lastSeenAt = next.lastSeenAt;
  if (next.declaredOffline != null) liveness.declaredOffline = next.declaredOffline;
}
