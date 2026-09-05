/**
 * 全部配置走环境变量 —— 这东西是要塞进一个 docker run 里跑的，
 * 配置文件还得挂卷，不如直接给变量。
 */

const KNOWN_AGENTS = ["claude", "codex", "grok", "cursor", "antigravity"] as const;
export type AgentId = (typeof KNOWN_AGENTS)[number];

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

function flag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function agentIds(): AgentId[] {
  // antigravity 走 `agy -p /usage`（实测能取），cursor 容器里还没有可用凭据，默认不在
  const raw = process.env.AGENT_IDS?.trim() || "claude,codex,grok,antigravity";
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

export const config = {
  dryRun,

  site: {
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      (dryRun ? "" : `${trimSlash(required("SITE_URL"))}/api/ingest/agents`),
    secret: process.env.TELEMETRY_INGEST_SECRET?.trim() ?? "",
  },

  /** 默认 10 分钟一轮，和站点 AGENT_LIMITS_PUSH_INTERVAL_MS 对齐 */
  pushIntervalMs: ms("PUSH_INTERVAL_MS", 600_000),
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 30_000),

  /**
   * 两个都空 = 不刷新 Claude，只记一行日志。
   * 值从 Claude Code 自己的安装里找，不要写进仓库。
   */
  claudeOAuth: {
    tokenUrl: process.env.CLAUDE_OAUTH_TOKEN_URL?.trim() ?? "",
    clientId: process.env.CLAUDE_OAUTH_CLIENT_ID?.trim() ?? "",
  },

  agentIds: agentIds(),

  /** antigravity 的限额问 `agy -p /usage`；镜像里在 /usr/local/bin，别处跑可改 */
  agyBin: process.env.AGY_BIN?.trim() || "agy",

  /**
   * TokenTracker 的 home。镜像里固定 HOME=/data，凭据落在卷上。
   * 单测 / DRY_RUN 可以另指。
   */
  home: process.env.HOME?.trim() || "/data",

  /**
   * 指向一份 TokenTracker `getUsageLimits` 形状的 JSON，用来 DRY_RUN / 对照站点。
   * 有这份就不调 TokenTracker、也不碰本机凭据。
   */
  limitsFixture: process.env.LIMITS_FIXTURE?.trim() ?? "",
} as const;
