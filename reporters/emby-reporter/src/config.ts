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
    ingestUrl: required("SITE_INGEST_URL"),
    accessClientId: required("ACCESS_CLIENT_ID"),
    accessClientSecret: required("ACCESS_CLIENT_SECRET"),
  },

  r2: {
    endpoint: trimSlash(required("R2_ENDPOINT")),
    bucket: required("R2_BUCKET"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },

  webhookPort: Math.max(1, Number(process.env.WEBHOOK_PORT) || 8787),
  // Emby 通知配置不能加自定义头，因此用 query 携带 token；局域网请求也不能视为可信。
  webhookToken: process.env.WEBHOOK_TOKEN?.trim() ?? "",

  resumeIntervalMs: ms("RESUME_INTERVAL_MS", 60_000),
  resumeLimit: Math.max(1, Math.min(24, Number(process.env.RESUME_LIMIT) || 8)),

  sessionActiveIntervalMs: ms("SESSION_ACTIVE_INTERVAL_MS", 2_000),
  sessionIdleIntervalMs: ms("SESSION_IDLE_INTERVAL_MS", 5 * 60_000),
  // Emby 的开播通知可能早于会话列表更新，不能在首轮空查后立刻退回闲档。
  wakeWindowMs: ms("WAKE_WINDOW_MS", 30_000),

  seekToleranceMs: ms("SEEK_TOLERANCE_MS", 1_500),
  reanchorMs: ms("REANCHOR_MS", 300_000),

  // 内容不变也要定期重推，否则接收端丢失状态后可能永远等不到下一次变化。
  fullPushIntervalMs: ms("FULL_PUSH_INTERVAL_MS", 10 * 60_000),

  imagesPerPush: Math.max(1, Number(process.env.IMAGES_PER_PUSH) || 4),
  posterHeight: 600,
  backdropHeight: 400,

  requestTimeoutMs: ms("REQUEST_TIMEOUT_MS", 10_000),
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 30_000),
} as const;
