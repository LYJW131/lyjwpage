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
  pagespeed?: PageSpeedPayload | null;
};

export type VercelMetricWindow = { fetchedAt: number; start: number; end: number };
export type LighthouseVitals = {
  score: number; lcpMs: number | null; tbtMs: number | null; cls: number | null;
  fcpMs: number | null; ttfbMs: number | null;
};
export type PageSpeedSample = { at: number; desktop: LighthouseVitals; mobile: LighthouseVitals };
export type PageSpeedPayload = {
  fetchedAt: number; start: number; samples: number; url: string;
  desktop: LighthouseVitals; mobile: LighthouseVitals;
};
export type VercelMetricsPayload = {
  functions: (VercelMetricWindow & { invocations: number; errors: number; timeouts: number;
    cpuP75Ms: number | null; memoryAvgMb: number | null }) | null;
  analytics: (VercelMetricWindow & { pageviews: number; visitors: number }) | null;
};
