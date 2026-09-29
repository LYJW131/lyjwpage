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

const heartbeatIntervalMs = ms("HEARTBEAT_INTERVAL_MS", 60_000);
if (heartbeatIntervalMs >= 300_000) throw new Error("HEARTBEAT_INTERVAL_MS 必须小于 Quest 陈旧窗口（300000）");

export const config = {
  dryRun: process.env.DRY_RUN === "true",
  discord: {
    token: required("DISCORD_BOT_TOKEN"),
    userId: required("DISCORD_USER_ID"),
  },
  site: {
    ingestUrl: process.env.SITE_INGEST_URL?.trim() || "https://ingest.homepage.lyjw.llc/api/ingest/quest",
    clientId: required("ACCESS_CLIENT_ID"),
    clientSecret: required("ACCESS_CLIENT_SECRET"),
  },
  heartbeatIntervalMs,
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 15_000),
} as const;
