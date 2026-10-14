import type { SiteAnalyticsPayload } from "@shared/site-analytics";

export const SITE_DEPLOYMENT_STATES = ["READY", "BUILDING", "QUEUED", "INITIALIZING", "ERROR", "CANCELED", "UNKNOWN"] as const;
export type SiteDeploymentState = (typeof SITE_DEPLOYMENT_STATES)[number];

export type SiteDeployment = {
  id: string;
  state: (typeof SITE_DEPLOYMENT_STATES)[number];
  createdAt: number;
  buildDurationMs: number | null;
  target: "production" | "preview";
  commit: { sha: string; branch: string | null; message: string | null } | null;
};

export type SiteDeploymentSnapshot = {
  fetchedAt: number;
  production: SiteDeployment | null;
  recent: SiteDeployment[];
  activeVersions: { id: string; percentage: number }[];
};

export type SiteDeploymentsPayload = SiteDeploymentSnapshot & {
  analytics?: SiteAnalyticsPayload | null;
  pagespeed?: PageSpeedPayload | null;
};

export type LighthouseVitals = {
  score: number; lcpMs: number | null; tbtMs: number | null; cls: number | null;
  fcpMs: number | null; ttfbMs: number | null;
};
// 一端没测出来时那一端为 null，两端都没测出来的一轮不入样本。
export type PageSpeedSample = { at: number; desktop: LighthouseVitals | null; mobile: LighthouseVitals | null };
export type PageSpeedPayload = {
  fetchedAt: number; start: number; samples: number; url: string;
  desktop: LighthouseVitals; mobile: LighthouseVitals;
};
