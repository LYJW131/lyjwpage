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

export const config = {
  emby: {
    url: trimSlash(required("EMBY_URL")),
    key: required("EMBY_API_KEY"),
    userId: required("EMBY_USER_ID"),
  },

  site: {
    /**
     * 直接给完整端点也行，省得为了改路径去动代码。
     */
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      `${trimSlash(required("SITE_URL"))}/api/ingest/emby`,
    /** 和站点的 TELEMETRY_INGEST_SECRET 对上。站点没配时才允许留空 */
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  r2: {
    endpoint: trimSlash(required("R2_ENDPOINT")),
    bucket: required("R2_BUCKET"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },

  /** Emby 的播放通知发到这个端口，见 webhook.ts */
  webhookPort: Math.max(1, Number(process.env.WEBHOOK_PORT) || 8787),
  /**
   * webhook 的共享密钥，可选。配了就必须在通知地址里带 `?token=<值>`，对不上 401。
   *
   * Emby 那个通知配置项加不了自定义请求头，但地址里可以带 query —— 「加不了头」
   * 只排除了 header 这一种写法。留空则谁都能发：局域网里任意一台机器 POST 一条
   * 伪造的 playback.stop 就能把站点上「正在观看」的卡片抹掉，伪造 start 则能把
   * 会话轮询顶到活跃档。NAS 上通常还跑着别的东西，同网段不一定都可信。
   */
  webhookToken: process.env.WEBHOOK_TOKEN?.trim() ?? "",

  /** 续播列表拉取节奏。它变得慢，60 秒足够，且只在有变化时才真的推 */
  resumeIntervalMs: ms("RESUME_INTERVAL_MS", 60_000),
  resumeLimit: Math.max(1, Math.min(24, Number(process.env.RESUME_LIMIT) || 8)),

  /**
   * 会话轮询：在播时 2 秒一轮，空闲时基本不轮。
   *
   * 开播由 Emby 的 webhook 叫醒，停止时停下，所以空闲那一档不是用来发现播放的，
   * 只是漏收 webhook 时的兜底 —— 定成分钟级，别在没人看片时空转。
   */
  sessionActiveIntervalMs: ms("SESSION_ACTIVE_INTERVAL_MS", 2_000),
  sessionIdleIntervalMs: ms("SESSION_IDLE_INTERVAL_MS", 5 * 60_000),
  /**
   * 收到 webhook 后至少按活跃档跟这么久。
   *
   * 「开始播放」那条常常比 Emby 自己的会话列表还早一步到，头一两轮查不到会话
   * 很正常；不给这段宽限期的话会立刻退回分钟级，白白错过刚开始的那段。
   */
  wakeWindowMs: ms("WAKE_WINDOW_MS", 30_000),

  /**
   * 位置只在偏离站点的推算值这么多时才推。
   *
   * 站点是按「上次锚点 + 真实流逝时间」自己推进度条的，正常播放它算得准，
   * 每 2 秒推一次纯属浪费（站点将来在 Vercel 上，那是按调用计费的函数）。
   * 只有拖了进度条才会偏出去，这个阈值就是「拖动」的判据。
   */
  seekToleranceMs: ms("SEEK_TOLERANCE_MS", 1_500),
  /** 没有拖动也隔一阵重新落一次锚，免得推算误差越积越大 */
  reanchorMs: ms("REANCHOR_MS", 30_000),

  /**
   * 即使什么都没变，也隔一阵整份重推一次。
   *
   * 站点那边的状态存在 Redis 里，可能被清空、也可能因为部署换了库。只靠
   * 「有变化才推」的话，一段时间没看片就会空在那儿等一个永远不来的变化。
   * 站点收到后会自己比对内容，没变就不会往浏览器推，所以这条不会变成定时广播。
   */
  fullPushIntervalMs: ms("FULL_PUSH_INTERVAL_MS", 10 * 60_000),

  /** 一次推送最多带几张图。整份列表的图一起塞会让 body 上兆 */
  imagesPerPush: Math.max(1, Number(process.env.IMAGES_PER_PUSH) || 4),
  /** 取图时给 Emby 的 maxHeight，和站点展示位对齐 */
  posterHeight: 600,
  backdropHeight: 400,

  requestTimeoutMs: ms("REQUEST_TIMEOUT_MS", 10_000),
  /** 带图的推送会大很多，给宽一点 */
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 30_000),
} as const;
