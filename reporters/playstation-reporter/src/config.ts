/**
 * 全部配置走环境变量 —— 这东西是要塞进一个 docker run 里跑的，
 * 配置文件还得挂卷，不如直接给变量。
 *
 * 和两个邻居的一处不同：站点那三个变量在这里**全是选填**。
 * `/api/ingest/playstation` 目前还不存在，所以这份上报器的主形态是 dry-run
 * （把本该 POST 的信封打到 stdout）。配上 `SITE_URL` / `SITE_INGEST_URL`
 * 才会真的往外发。
 */

function ms(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
  return value;
}

function count(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** 站点端点：给了完整地址就用它，只给站点地址就按仓库约定拼路径，都没有就是 dry-run */
function ingestUrl(): string {
  const explicit = process.env.SITE_INGEST_URL?.trim();
  if (explicit) return explicit;
  const site = process.env.SITE_URL?.trim();
  // 端点名按 AGENTS.md 第 1 条：/api/ingest/<来源>，来源是「数据是谁产生的」。
  // 产生这份数据的是 PlayStation，不是这个上报程序，所以是 playstation 而不是
  // playstation-reporter
  return site ? `${trimSlash(site)}/api/ingest/playstation` : "";
}

export const config = {
  site: {
    /** 空串 = 没配 = dry-run，把信封打到 stdout */
    ingestUrl: ingestUrl(),
    /** 和站点的 TELEMETRY_INGEST_SECRET 对上。站点没配时才允许留空 */
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  psn: {
    /**
     * 浏览器里手工取的那串 NPSSO，见 README。
     *
     * 状态文件里已经有一份没过期的 refresh token 时用不到它 —— 所以这里不是
     * `required()`：真正的「缺了就没法干活」判定在 auth.ts，那时才知道状态文件
     * 里有没有货。
     */
    npsso: process.env.PSN_NPSSO?.trim() ?? "",

    /**
     * 要跟的账号。`"me"` 是 PSN 给「本次鉴权的那个账号」留的字面量
     * （psn-api 的 getUserPlayedGames 类型注释也明确支持），默认就用它，
     * 免得还要先去查自己的 accountId。
     */
    accountId: process.env.PSN_ACCOUNT_ID?.trim() || "me",

    /** 「最近在玩」一次要多少条。站点将来大概也只展示十来条 */
    playedGamesLimit: count("PLAYED_GAMES_LIMIT", 20),

    /**
     * 请求 PSN 时带的 Accept-Language，决定游戏名给哪种语言的官方译名
     * （zh-Hans 下《Split Fiction》叫「双影奇境」，实测确认）。站点是中文的，
     * 默认就要中文名；设成空串则不带这个头，上游默认给英文。
     */
    language: (process.env.PSN_LANGUAGE ?? "zh-Hans").trim(),
  },

  /**
   * token 状态文件。默认相对路径，容器里 WORKDIR 是 /app，所以落在 /app/state/
   * —— compose 把卷挂在那儿，容器内外默认值是同一个地方，本地 `--once` 也不用先配。
   * 文件以 0600 写入，内容是明文 token，别挪到会被打包 / 备份的地方。
   */
  stateFile: process.env.PSN_STATE_FILE?.trim() || "./state/auth.json",

  /**
   * 轮询 PSN 的节奏。两路各有各的间隔：
   * - presence 是「此刻在玩」，翻面要尽快看见，30 秒；
   * - 已玩列表是累计量，5 分钟足够，它还是一次几十条的大响应。
   */
  presenceIntervalMs: ms("PRESENCE_INTERVAL_MS", 30_000),
  playedGamesIntervalMs: ms("PLAYED_GAMES_INTERVAL_MS", 5 * 60_000),

  /**
   * 即使什么都没变，也隔一阵整份重推一次。
   *
   * 和另外两份上报器同一个理由：站点那边的状态存在 Redis 里，可能被清空、也可能
   * 因为部署换了库。只靠「有变化才推」的话，一段时间不开机就会空在那儿等一个
   * 永远不来的变化。站点收到后会自己比对内容，没变就不会往浏览器推。
   */
  fullPushIntervalMs: ms("FULL_PUSH_INTERVAL_MS", 10 * 60_000),

  /** 出错之后隔多久再来一次：从 retryMs 起每连错一次翻倍，到 maxRetryMs 封顶 */
  retryMs: ms("RETRY_MS", 15_000),
  maxRetryMs: ms("MAX_RETRY_MS", 10 * 60_000),

  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 15_000),
} as const;

/** 配了站点地址才真的往外发，否则整份就是 dry-run */
export const dryRun = config.site.ingestUrl === "";
