/**
 * 全部配置走环境变量，和 agents-reporter 一个写法。compose 的 env_file 说了算：
 * 机器上 `.env` 里写了的值永远压过这里的默认值。
 */

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

function flag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** 计费周期从每月几号归零。29 之后不是每个月都有，直接不收 */
function cycleDay(): number {
  const raw = process.env.TRAFFIC_CYCLE_DAY?.trim();
  if (!raw) return 1;
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error("TRAFFIC_CYCLE_DAY 必须是 1–28 的整数（29 之后不是每个月都有）");
  }
  return day;
}

/** 套餐给的周期流量，字节。没配就没有配额，卡片只报用量 */
function quotaBytes(): number | null {
  const raw = process.env.TRAFFIC_QUOTA_BYTES?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("TRAFFIC_QUOTA_BYTES 必须是正整数（字节）");
  return value;
}

/** 变量写了但留空 = 明确关掉（比如不攒流量）；没写才用默认值 */
function pathOr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw.trim();
}

const siteUrl = process.env.SITE_URL?.trim() ?? "";
const onlineCounterUrl = process.env.ONLINE_COUNTER_URL?.trim() ?? "";

export const config = {
  /** 采一轮、把报文打到 stdout 就退出，不推送 */
  dryRun: flag("DRY_RUN"),

  site: {
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      (siteUrl ? `${trimSlash(siteUrl)}/api/ingest/server` : ""),
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  hostId: process.env.HOST_ID?.trim() || "misaka-jp",
  /** 机房所在城市。站点不从 IP 猜，查 IP 拿不到 city 时用它 */
  location: process.env.HOST_LOCATION?.trim() || "Tokyo",
  /** 宿主机 /etc 挂进容器后的前缀，compose 里是 /host。留空 = 直接跑在宿主机上 */
  hostRoot: (process.env.HOST_ROOT?.trim() ?? "").replace(/\/+$/, ""),

  /**
   * 三档节奏，和 agents-reporter、playstation-reporter 逐档对齐：
   *
   *   有人正看着（`online`，只数**可见**的页面）      → 60 秒
   *   页面开着但都在后台（`connections`，数开着的连接） → 2 分钟
   *   一个页面都没开                                  → 15 分钟
   *
   * 这份快照本身就是心跳。慢档锚着站点的 SERVER_STALE_MS（lib/freshness，50 分钟
   * = 三轮 + 余量）：改慢档必须同步改那边。
   */
  cadence: {
    liveIntervalMs: ms("LIVE_INTERVAL_MS", 60_000),
    openIntervalMs: ms("OPEN_INTERVAL_MS", 120_000),
    idleIntervalMs: ms("IDLE_INTERVAL_MS", 900_000),
    onlineCountUrl: onlineCounterUrl ? `${trimSlash(onlineCounterUrl)}/count` : "",
    countUrl: siteUrl ? `${trimSlash(siteUrl)}/count` : "",
    countTimeoutMs: ms("COUNT_TIMEOUT_MS", 2_500),
  },
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 10_000),

  /** 流量累计与 12 小时 CPU 窗口的状态文件；留空 = 不攒，报文里这两块为 null */
  trafficStatePath: pathOr("TRAFFIC_STATE_PATH", "/data/traffic.json"),
  cycleDay: cycleDay(),
  quotaBytes: quotaBytes(),

  /** 推送账本（过去 12 小时推成功几封）；留空 = 只记在内存里 */
  pushLedgerPath: pathOr("PUSH_LEDGER_PATH", "/data/pushes.json"),
  /** 镜像构建时烧进来的提交（build-reporters.yml 传 GIT_SHA），本地直接跑时没有 */
  reporterCommit: process.env.REPORTER_COMMIT?.trim() || null,
} as const;
