/**
 * 全部配置走环境变量 —— 这东西是要塞进一个 docker run 里跑的，
 * 配置文件还得挂卷，不如直接给变量。
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function ms(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
  return value;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** 从只填了**源**的那类变量拼出完整端点。没配返回空串，含义由用它的地方定 */
function endpoint(name: string, path: string): string {
  const origin = process.env[name]?.trim();
  return origin ? `${trimSlash(origin)}${path}` : "";
}

export const config = {
  site: {
    /**
     * 数据和凭据走同一个地址：POST 交数据，GET 取干活要用的 token。
     * 直接给完整端点也行，省得为了改路径去动代码。
     */
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      `${trimSlash(required("SITE_URL"))}/api/ingest/apple-music`,
    /** 和站点的 TELEMETRY_INGEST_SECRET 对上。站点没配时才允许留空 */
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  /** Apple Music 目录查询地区，默认 cn */
  storefront: (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase(),

  /**
   * 没人看时轮询 Apple 的节奏。
   *
   * 这个间隔同时是「此刻在听」的观测精度：判定靠的是看见最近播放列表里排第一的
   * 那项换了人，所以换歌时刻最多晚这么久被记下。没人看的时候这一轮**只为记录
   * 历史而跑**，那份记录晚一会儿落地没人受影响 —— 于是拿精度换请求量：换歌时刻
   * 和时长的记录精度掉到最坏 15 分钟，闲时对 Apple 的请求从 1440 次/天降到
   * 96 次/天。要准头的那段时间由下面那档负责。
   *
   * 站点的 `LISTENING_STALE_MS`（50 分钟）锚的就是这一档：闲时的兜底整推搭在
   * tick 上，实际心跳节奏等于这个间隔。改这里要同步 `src/lib/freshness.ts`。
   */
  recentIntervalMs: ms("RECENT_INTERVAL_MS", 15 * 60_000),

  /**
   * 有观众时的轮询节奏。
   *
   * 上面那个取舍只在**没人看**的时候才划算 —— 那时快一点也没人受益。有人正看着
   * 站点的这几分钟里多打几次 Apple，换来的是换歌延迟从最坏 15 分钟降到 30 秒，
   * 这是唯一有人能看见的那段时间。
   *
   * 改这一档不用动站点的 `LISTENING_STALE_MS`：那个窗口锚的是闲时那档 —— 有人
   * 看时只会更快，判活的下限始终由慢的那档定。
   */
  liveIntervalMs: ms("LIVE_INTERVAL_MS", 30_000),

  /**
   * 在线人数读取地址。填**源**，`/count` 这边拼 —— 和站点侧的
   * NEXT_PUBLIC_ONLINE_COUNTER_URL、playstation-reporter 的同名变量一个形状。
   *
   * 不配就是空串，门一路按「没人在线」走，节奏恒等于今天的 recentIntervalMs：
   * 少配一个变量不该让它变快，也不该让它变慢。
   */
  onlineCountUrl: endpoint("ONLINE_COUNTER_URL", "/count"),

  /** 人数读不回来不该拖着这一轮等，超时就当没人在线 */
  onlineCountTimeoutMs: ms("ONLINE_COUNT_TIMEOUT_MS", 2_500),

  /**
   * 即使什么都没变，也隔一阵整份重推一次。
   *
   * 站点那边的状态存在 Redis 里，可能被清空、也可能因为部署换了库。只靠
   * 「有变化才推」的话，一段时间没听歌就会空在那儿等一个永远不来的变化。
   * 站点收到后会自己比对内容，没变就不会往浏览器推，所以这条不会变成定时广播。
   *
   * 这个到期判定写在 tick 里，闲时那一档（15 分钟）已经比它长，所以没人看时
   * 每一轮 tick 都判到期：整推和轮询合一，「有变化才推」在无人档实际不起作用，
   * 站点固定每 15 分钟收一封 —— 站点侧的断流窗口锚的就是这个节奏。
   */
  fullPushIntervalMs: ms("FULL_PUSH_INTERVAL_MS", 10 * 60_000),

  /** 上游端点的硬限制就是 10，传更大直接 400 */
  recentLimit: 10,

  requestTimeoutMs: ms("REQUEST_TIMEOUT_MS", 10_000),
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 15_000),
} as const;
