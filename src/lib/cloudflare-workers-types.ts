export const CLOUDFLARE_WORKERS = [
  { name: "api", description: "状态 API · 实时推送" },
  { name: "online-counter", description: "在线人数 · 连接计数" },
  { name: "playstation-reporter", description: "PlayStation · 定时上报" },
] as const;

export type CloudflareWorkerName = (typeof CLOUDFLARE_WORKERS)[number]["name"];

export type WorkerMetrics = {
  requests: number;
  errors: number;
  subrequests: number;
  cpuTimeP50Ms: number | null;
};

export type WorkerDeployment = {
  deployedAt: number;
  versions: { id: string; percentage: number }[];
};

export type CloudflareWorkersPayload = {
  fetchedAt: number;
  windowStart: number;
  windowEnd: number;
  workers: {
    name: CloudflareWorkerName;
    metrics: WorkerMetrics | null;
    history: { at: number; requests: number }[];
    deployment: WorkerDeployment | null;
  }[];
};
