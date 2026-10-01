export type LagEntry<T> = {
  updatedAt: number;
  data: T;
};

export const LAG_KEYS = {
  agentStatus: "agent-status:v1",
  githubChart: "github-chart:v1",
  githubRepo: "github-repo:v1",
  vercelDeployments: "vercel-deployments:v1",
  vercelMetrics: "vercel-metrics:v1",
  pagespeed: "pagespeed:v1",
  cloudflareDeployments: "cloudflare-deployments:v1",
  cloudflareMetrics: "cloudflare-metrics:v1",
  sentry: "sentry:v1",
  server: "server:v1",
  limits: "limits:v1",
  timezone: "timezone:v1",
  activity: "activity:v1",
  workouts: "workouts:v1",
  reporterServer: "reporter:server-reporter:v1",
  reporterAgents: "reporter:agents-reporter:v1",
  codingUsage: "coding-usage:v1",
  codingYear: "coding-year:v1",
} as const;

export type LagKey = (typeof LAG_KEYS)[keyof typeof LAG_KEYS];

export interface LagStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export function isLagEntry(value: unknown): value is LagEntry<unknown> {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) && "data" in row;
}

export async function readLag<T>(kv: LagStore, key: LagKey): Promise<LagEntry<T> | null> {
  const raw = await kv.get(key, "text");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isLagEntry(parsed) ? (parsed as LagEntry<T>) : null;
  } catch {
    return null;
  }
}

export async function writeLag<T>(kv: LagStore, key: LagKey, data: T, updatedAt = Date.now()): Promise<void> {
  const entry: LagEntry<T> = { updatedAt, data };
  await kv.put(key, JSON.stringify(entry));
}
