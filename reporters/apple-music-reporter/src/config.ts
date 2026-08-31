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
   *
   * 睡的时候不是一觉睡满：闲档拆成一个个快档长度的小觉，每觉醒来问一次人数，
   * 问到人立刻开跑（见 index.ts 的 waitForNextTick）。否则「从没人到有人」最坏
   * 要等满这一档 —— 而那正是有人在看着屏幕等的那一刻。
   */
  idleIntervalMs: ms("IDLE_INTERVAL_MS", 15 * 60_000),

  /**
   * 有人**正看着**时的轮询节奏。
   *
   * 上面那个取舍只在没人看的时候才划算 —— 那时快一点也没人受益。有人正看着
   * 站点的这几分钟里多打几次 Apple，换来的是换歌延迟从最坏 15 分钟降到 1 分钟，
   * 这是唯一有人能看见的那段时间。
   *
   * 改这一档不用动站点的 `LISTENING_STALE_MS`：那个窗口锚的是闲档 —— 有人看时
   * 只会更快，判活的下限始终由最慢那档定。
   */
  liveIntervalMs: ms("LIVE_INTERVAL_MS", 60_000),

  /**
   * 页面**开着但都在后台**时的节奏（切走的标签页、锁了屏的手机）。
   *
   * 它们在 online-counter 那侧算 0 —— 站点侧 use-online-count 在页面不可见时把
   * 连接整条关掉；但 live-push 那条不关，所以「开着」由它数。切回来那一下不该
   * 看见一刻钟前的曲目，又不值得按可见那档一直打 Apple，居中。
   */
  openIntervalMs: ms("OPEN_INTERVAL_MS", 120_000),

  /**
   * 两个人头数的读取地址。都填**源**，`/count` 这边拼 —— 和站点侧那几个
   * NEXT_PUBLIC_*_URL、另外两个上报器的同名变量一个形状。
   *
   * 哪个不配就是空串，那一档用不上（当它恒为 0）：少配一个变量不该让它变快。
   * live-push 是一份生产一个，填的是 Vercel 那一份，国内那份生产上开着的页面
   * 不进这个判断 —— 少数了只会更慢，和读不到时同一个方向。
   */
  onlineCountUrl: endpoint("ONLINE_COUNTER_URL", "/count"),
  openCountUrl: endpoint("LIVE_PUSH_URL", "/count"),

  /** 人头数读不回来不该拖着这一轮等，超时就当没人 */
  countTimeoutMs: ms("COUNT_TIMEOUT_MS", 2_500),

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
