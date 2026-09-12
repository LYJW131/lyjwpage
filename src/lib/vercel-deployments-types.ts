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
};

export type VercelMetricWindow = { fetchedAt: number; start: number; end: number };
export type VercelWebVitals = {
  score: number | null; lcpMs: number | null; inpMs: number | null; cls: number | null;
  fcpMs: number | null; ttfbMs: number | null;
};
export type VercelMetricsPayload = {
  speed: (VercelMetricWindow & { desktop: VercelWebVitals; mobile: VercelWebVitals }) | null;
  functions: (VercelMetricWindow & { invocations: number; errors: number; timeouts: number;
    cpuP75Ms: number | null; memoryAvgMb: number | null }) | null;
  analytics: (VercelMetricWindow & { pageviews: number; visitors: number }) | null;
};
