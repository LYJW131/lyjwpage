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
  dryRun: process.env.DRY_RUN === "true",
  discord: {
    token: required("DISCORD_BOT_TOKEN"),
    userId: required("DISCORD_USER_ID"),
  },

  site: {
    ingestUrl:
      process.env.SITE_INGEST_URL?.trim() ||
      `${trimSlash(required("SITE_URL"))}/api/ingest/discord`,
    secret: required("TELEMETRY_INGEST_SECRET"),
  },

  /** 没变化也隔这么久补一封，站点靠 observedAt 判上报器死活 */
  heartbeatIntervalMs: ms("HEARTBEAT_INTERVAL_MS", 60_000),
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 15_000),
} as const;
