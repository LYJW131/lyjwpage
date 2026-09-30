export const CLOUDFLARE_WORKERS = [
  { name: "api", description: "状态核心 · 公开读取 · 实时推送与在线人数" },
  { name: "ingress", description: "上报入口 · Access 鉴权" },
  { name: "collector", description: "定时采集 · PlayStation 与各家外部数据" },
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
  commit: { sha: string; branch: string | null; message: string | null } | null;
};

export type CloudflareDeploymentsPayload = {
  fetchedAt: number;
  workers: { name: CloudflareWorkerName; deployment: WorkerDeployment | null }[];
};

export type CloudflareMetricsPayload = {
  fetchedAt: number;
  windowStart: number;
  windowEnd: number;
  workers: { name: CloudflareWorkerName; metrics: WorkerMetrics | null }[];
};

export type CloudflareWorkersPayload = {
  fetchedAt: number | null;
  windowStart: number | null;
  windowEnd: number | null;
  deploymentsFetchedAt: number | null;
  workers: {
    name: CloudflareWorkerName;
    metrics: WorkerMetrics | null;
    deployment: WorkerDeployment | null;
  }[];
};
