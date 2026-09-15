export const DEPLOYMENT_STATES = ["READY", "BUILDING", "QUEUED", "INITIALIZING", "ERROR", "CANCELED", "UNKNOWN"] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

export type VercelDeployment = {
  id: string;
  state: DeploymentState;
  createdAt: number;
  buildDurationMs: number | null;
  target: "production" | "preview";
  commit: { sha: string; branch: string | null; message: string | null } | null;
};

export type VercelDeploymentsPayload = {
  fetchedAt: number;
  production: VercelDeployment | null;
  recent: VercelDeployment[];
  metrics?: VercelMetricsPayload | null;
  /** 性能实测由 Google PageSpeed 提供，和 Vercel 无关，所以不进 metrics。 */
  pagespeed?: PageSpeedPayload | null;
};

export type VercelMetricWindow = { fetchedAt: number; start: number; end: number };
/** Lighthouse 单次实测；没有 INP（那是真实用户指标），同一轮的 TBT 代替它。 */
export type LighthouseVitals = {
  score: number; lcpMs: number | null; tbtMs: number | null; cls: number | null;
  fcpMs: number | null; ttfbMs: number | null;
};
export type PageSpeedSample = { at: number; desktop: LighthouseVitals; mobile: LighthouseVitals };
/** 每一格是滚动窗口内各轮实测的中位数，不是某一轮的完整报告。 */
export type PageSpeedPayload = {
  /** 窗口内最近一轮的时间；`start` 是最早一轮，`samples` 是参与中位数的轮数。 */
  fetchedAt: number; start: number; samples: number; url: string;
  desktop: LighthouseVitals; mobile: LighthouseVitals;
};
export type VercelMetricsPayload = {
  functions: (VercelMetricWindow & { invocations: number; errors: number; timeouts: number;
    cpuP75Ms: number | null; memoryAvgMb: number | null }) | null;
  analytics: (VercelMetricWindow & { pageviews: number; visitors: number }) | null;
};
