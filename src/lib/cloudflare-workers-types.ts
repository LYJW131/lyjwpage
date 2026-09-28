/** 本仓库的 Worker；统计查询（GraphQL 的 scriptName_in）和卡片都按这张表，不公开账号里别的 Worker */
export const CLOUDFLARE_WORKERS = [
  { name: "api", description: "状态核心 · 公开读取 · 实时推送" },
  { name: "ingress", description: "上报入口 · Access 鉴权" },
  { name: "collector", description: "定时采集 · PlayStation 与各家外部数据" },
  { name: "online-counter", description: "在线人数 · 连接计数" },
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

/** 可滞后层里的部署那一份：按名字带着，Worker 名单再变也不会错位 */
export type CloudflareDeploymentsPayload = {
  fetchedAt: number;
  workers: { name: CloudflareWorkerName; deployment: WorkerDeployment | null }[];
};

export type CloudflareWorkersPayload = {
  fetchedAt: number;
  windowStart: number;
  windowEnd: number;
  workers: {
    name: CloudflareWorkerName;
    metrics: WorkerMetrics | null;
    deployment: WorkerDeployment | null;
  }[];
};
