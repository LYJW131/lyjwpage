export const COLLECTOR_JOBS = [
  "apple-recent",
  "provider-status",
  "pagespeed",
  "github-chart",
  "github-repo",
  "vercel-deployments",
  "vercel-metrics",
  "cloudflare-deployments",
  "cloudflare-metrics",
  "sentry-status",
] as const;

export type CollectorJobName = (typeof COLLECTOR_JOBS)[number];

export function isCollectorJob(name: string): name is CollectorJobName {
  return (COLLECTOR_JOBS as readonly string[]).includes(name);
}

export type CollectorJobOutcome = {
  job: string;
  status: "ok" | "skipped" | "error";
  detail?: string;
  ms: number;
};

export interface CollectorRpc {
  refresh(jobs: string[]): Promise<CollectorJobOutcome[]>;
}
