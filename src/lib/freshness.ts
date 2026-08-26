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
 * 用量那份健康时每个采集间隔必发一次（上报器默认 10 分钟，它带着采集时刻，
 * 每轮都算变化）。新鲜度只看它 —— 此刻那份没变就不发，不能拿来判活。
 *
 * 这个窗口必须**大于**上报器那侧的用量间隔，否则每轮刷新前的最后一段会被判成
 * 采集侧卡住，两盏活动灯白灭一次。那边调到 15 分钟以上时，这里要跟着放宽。
 */
export const VIBECODING_STALE_MS = 15 * 60_000;

/**
 * PlayStation 上报 Worker 每 15 分钟一轮 cron，**每轮都发 presence**（内容没变
 * 也发，那一封就是心跳）。所以「多久没刷新」等价于「Worker 还活着没有」。
 * 窗口取三轮多一点：漏一两轮不该让卡片翻脸，连着三轮没到才算 Worker 死了、
 * 或者 PSN 把它的令牌拒了。
 *
 * 45 分钟之外还要再宽一截给缓存：端点读的是 'use cache' 那份快照，心跳只推
 * 普通 tag（stale-while-revalidate），拿到手的 observedAt 可能比 Redis 里那份
 * 旧一个刷新周期。3 × 15 = 45，留到 50。上报器那侧改 cron 间隔时这里要跟着改。
 *
 * 服务端可用 PLAYSTATION_STALE_MS 改。这一路没有 declaredOffline 可用 ——
 * Worker 悄悄死掉和主机关机长得一模一样，只能靠这个窗口分开，而分不开的那半
 * （到底在不在玩）就该老实说不知道，不是说不在线。
 */
export const PLAYSTATION_STALE_MS = 50 * 60_000;

export function playstationStaleMs() {
  const configured = Number(process.env.PLAYSTATION_STALE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : PLAYSTATION_STALE_MS;
}

/**
 * 服务器上报器默认 15 秒一轮，三倍没消息就算这份断了。
 *
 * 和充电头同一套：漏一条不该翻脸，连着三条没到才算上报器出事。服务端可用
 * `SERVER_STALE_MS` 改 —— 上报器那侧改 `INTERVAL_MS` 时这里要跟着放宽。
 */
export const SERVER_STALE_MS = 45_000;

export function serverStaleMs() {
  const configured = Number(process.env.SERVER_STALE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : SERVER_STALE_MS;
}

/**
 * `at` 这一刻，UTC 偏移为 `secondsFromGMT` 的地方是哪一天（YYYY-MM-DD）。
 *
 * 摆在这个文件里是因为它前后端各算一遍：服务端在取数出口盖 `currentAtSource`
 * 供首帧用，浏览器挂载后拿自己的钟再算一次。两处必须是同一段代码 —— 各写一遍
 * 的话，跨夜那一下两边会各给各的答案。
 *
 * 也放在这里而不是 lib/activity：那个文件连着 Redis，客户端组件 import 不得。
 */
export function localDate(at: number, secondsFromGMT: number): string {
  return new Date(at + secondsFromGMT * 1000).toISOString().slice(0, 10);
}

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
