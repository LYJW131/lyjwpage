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
  /** 流量最大版本的构建提交；手动上传等无构建记录时为空。 */
  commit: { sha: string; branch: string | null; message: string | null } | null;
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
