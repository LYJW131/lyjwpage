/**
 * 状态新鲜度：源站只盖时间戳，stale 由浏览器用自己的钟现算。
 *
 * 这些窗口必须前后端同一份 —— 源站 listening/now 现选 Hero 时用心跳窗口
 * （选择本身不进缓存），浏览器翻灰用的也是它。
 */

/**
 * 上报器每 90 秒心跳一次。窗口默认三倍多一点：漏一条或 ingest 冷启动慢一点
 * 都不该翻掉线，连续三次没到才算崩溃 / 断网。优雅离开走 declaredOffline，
 * 不等这个窗口。
 *
 * 从 30 秒 / 90 秒放宽到 90 秒 / 300 秒。纯心跳是 /api/ingest/mac 的主要流量
 * —— 实测 12 小时 1.9K 次调用里约三分之二是它，而它是全站函数用量最大的一条
 * 路径。这段间隔唯一换掉的是「崩溃 / 断网 / 强制关机」的判定延迟：关盖、睡眠、
 * 退出都走 declaredOffline，仍然是收到那一条就瞬时翻转，日常体验不变。
 *
 * ⚠️ 顺序不能反：**窗口先放宽，上报器再降频**。反过来做的话，中间那段时间
 * 上报器 90 秒才来一条、而站点还按 90 秒判，每一轮都踩在窗口边上，全站会
 * 断续显示离线。上报器那侧的间隔在 MacTelemetryHub 的 ServiceController
 * 主循环里（心跳补发的那个下限），两边都改完才算改完。
 *
 * 服务端可用 HEARTBEAT_WINDOW_MS 改 —— 注意生产环境里这个变量是显式配着的，
 * 改这里的默认值不会自动生效，Vercel 和 EdgeOne 两边都要跟着改。
 * 浏览器用 payload 里盖上的那份，和充电头的 staleAfterMs 同一套。
 */
export const HEARTBEAT_WINDOW_MS = 300_000;

export function heartbeatWindowMs() {
  const configured = Number(process.env.HEARTBEAT_WINDOW_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : HEARTBEAT_WINDOW_MS;
}

/**
 * Apple Music 上报器 60 秒轮一次上游、10 分钟兜底整推一次，
 * 三倍兜底间隔还没消息就是它出事了。
 */
export const LISTENING_STALE_MS = 30 * 60_000;

/**
 * CodexBar 用量健康时 10 分钟必发一次；限额和会话没变就不发，
 * 新鲜度只看用量这份。
 */
export const VIBECODING_STALE_MS = 15 * 60_000;

/** 充电头默认上报 30 秒，3 倍没消息就算这份数据断了。服务端可用环境变量加长。 */
export const CHARGER_STALE_MS = 90_000;

export type FreshnessInput = {
  /** 访客钟。首帧没有时刻时传 0，不当过期，避免和服务端 HTML 对不上。 */
  now: number;
  /** 源站盖章的到来时刻。0 / 缺省 = 从没见过 */
  at: number | null | undefined;
  windowMs: number;
  /** 上报器亲口说走了：不是时间函数，立刻算过期 */
  declaredOffline?: boolean;
};

/**
 * 这份快照现在算不算过期。
 *
 * `now === 0` 是首屏哨兵（见 useMountedAt）：还没有访客钟，除了亲口离线
 * 以外都不判过期，否则服务端 HTML 和 hydrate 会各画各的。
 */
export function isStale({ now, at, windowMs, declaredOffline = false }: FreshnessInput) {
  if (declaredOffline) return true;
  if (!now) return false;
  if (at == null) return false;
  if (at <= 0) return true;
  return now - at > windowMs;
}
