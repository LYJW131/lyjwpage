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
  // observedAt 是这一格上次成功确认的时刻。0 表示请求失败且没有上一份可沿用，读取侧按过期处理，不当成刚确认没有部署。
  workers: { name: CloudflareWorkerName; deployment: WorkerDeployment | null; observedAt?: number }[];
};

export type CloudflareMetricsPayload = {
  fetchedAt: number;
  windowStart: number;
  windowEnd: number;
  workers: { name: CloudflareWorkerName; metrics: WorkerMetrics | null }[];
};

// 有数字就用这一格自己的确认时刻（含 0：失败且没有上一份）。缺字段才退回整份时间，兼容还没写 observedAt 的旧值。
export function deploymentCheckedAt(observedAt: number | null | undefined, fetchedAt: number | null | undefined): number | null | undefined {
  return typeof observedAt === "number" ? observedAt : fetchedAt;
}

export type CloudflareWorkersPayload = {
  fetchedAt: number | null;
  windowStart: number | null;
  windowEnd: number | null;
  deploymentsFetchedAt: number | null;
  workers: {
    name: CloudflareWorkerName;
    metrics: WorkerMetrics | null;
    deployment: WorkerDeployment | null;
    deploymentObservedAt: number | null;
  }[];
};
