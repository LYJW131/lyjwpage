/**
 * 全部配置走环境变量 —— 这东西是要塞进一个 docker run 里跑的，
 * 配置文件还得挂卷，不如直接给变量。
 */

const KNOWN_AGENTS = ["claude", "codex", "grok", "cursor", "antigravity"] as const;
export type AgentId = (typeof KNOWN_AGENTS)[number];

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

function agentIds(): AgentId[] {
  const raw = process.env.AGENT_IDS?.trim() || "claude,codex,grok,cursor,antigravity";
  const ids: AgentId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!(KNOWN_AGENTS as readonly string[]).includes(id)) {
      throw new Error(`AGENT_IDS 里有不认识的 id：${id}`);
    }
    if (!ids.includes(id as AgentId)) ids.push(id as AgentId);
  }
  if (ids.length === 0) throw new Error("AGENT_IDS 不能是空的");
  return ids;
}

const dryRun = flag("DRY_RUN");
const siteUrl = process.env.SITE_URL?.trim() ?? "";
const onlineCounterUrl = process.env.ONLINE_COUNTER_URL?.trim() ?? "";

export const config = {
  dryRun,

  /** 镜像构建时烧进来的提交（build-reporters.yml 传 GIT_SHA），站点卡片据此显示线上跑的是哪一版 */
  reporterCommit: process.env.REPORTER_COMMIT?.trim() || null,
  /** 推送账本（过去 12 小时推成功几封），和凭据同在挂进来的 /data 卷上；留空 = 只记在内存里 */
  pushLedgerPath: process.env.PUSH_LEDGER_PATH === undefined ? "/data/pushes.json" : process.env.PUSH_LEDGER_PATH.trim(),

  site: {
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      (siteUrl ? `${trimSlash(siteUrl)}/api/ingest/agents` : ""),
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  /** 与 server / PlayStation 共用人数分档逻辑；限额使用 5 / 10 / 60 分钟。 */
  cadence: {
    liveIntervalMs: ms("LIVE_INTERVAL_MS", 300_000),
    openIntervalMs: ms("OPEN_INTERVAL_MS", 600_000),
    idleIntervalMs: ms("IDLE_INTERVAL_MS", 3_600_000),
    /** 两个独立 Worker 的计数口，不携带上报凭据。 */
    onlineCountUrl: onlineCounterUrl ? `${trimSlash(onlineCounterUrl)}/count` : "",
    countUrl: siteUrl ? `${trimSlash(siteUrl)}/count` : "",
    countTimeoutMs: ms("COUNT_TIMEOUT_MS", 2_500),
  },
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 30_000),

  /**
   * Cursor 活动那条快循环。平时不单独查，跟着限额那一轮拉用量时顺手看最新事件；
   * 看到 5 分钟内有事件才起快循环：有新事件就按 fast 间隔查，没有就翻倍拉长到 max，
   * 超过 5 分钟没新事件、或者没人开着页面就停，交回限额那一轮。
   */
  cursorNow: {
    fastIntervalMs: ms("CURSOR_NOW_FAST_INTERVAL_MS", 60_000),
    maxIntervalMs: ms("CURSOR_NOW_MAX_INTERVAL_MS", 240_000),
  },

  /**
   * 两个都空时自动读取 Claude Code 安装包的生产配置；显式覆盖时必须一起填。
   */
  claudeOAuth: {
    tokenUrl: process.env.CLAUDE_OAUTH_TOKEN_URL?.trim() ?? "",
    clientId: process.env.CLAUDE_OAUTH_CLIENT_ID?.trim() ?? "",
  },

  claudeBin: process.env.CLAUDE_BIN?.trim() || "claude",

  agentIds: agentIds(),

  /** 直接注入 Cursor JWT；没有就读 `$XDG_CONFIG_HOME/cursor/auth.json` */
  cursorAuthToken: process.env.CURSOR_AUTH_TOKEN?.trim() ?? "",

  /** Antigravity 的订阅名（如 "Google AI Pro"）。配额接口不带它，只能人工指定；空 = 不渲染套餐 */
  antigravityPlanLabel: process.env.ANTIGRAVITY_PLAN_LABEL?.trim() ?? "",

  /** Antigravity 配额端点；默认打 daily-cloudcode-pa */
  antigravityQuotaUrl:
    process.env.ANTIGRAVITY_QUOTA_URL?.trim() ||
    "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",

  /**
   * Google OAuth 客户端。配了就直接用；都空就从 `agy` 二进制里扫候选，刷新时逐对试
   * （见 providers/antigravity-oauth-client.ts）。这两个值不要写进仓库。
   */
  antigravityOAuth: {
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ?? "",
  },

  /** 扫 OAuth 客户端常量用的 `agy` 二进制；镜像里在 /usr/local/bin，别处跑可改 */
  agyBin: process.env.AGY_BIN?.trim() || "agy",

  /**
   * 凭据 home。镜像里固定 HOME=/data。Grok 另认 `GROK_HOME`，Codex 另认 `CODEX_HOME`。
   * 单测 / DRY_RUN 可以另指。
   */
  home: process.env.HOME?.trim() || "/data",

  /**
   * `{ "<id>": <该家原始 HTTP 响应体> }`。有这份就不出网、不读凭据，走各家规整函数。
   */
  limitsFixture: process.env.LIMITS_FIXTURE?.trim() ?? "",
} as const;
