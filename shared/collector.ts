export const COLLECTOR_JOBS = [
  "apple-recent",
  "provider-status",
  "pagespeed",
  "github-chart",
  "github-repo",
  "vercel-deployments",
  "vercel-metrics",
  "site-deployments",
  "site-analytics",
  "cloudflare-deployments",
  "cloudflare-metrics",
  "sentry-status",
  "avatar-watch",
] as const;

export type CollectorJobName = (typeof COLLECTOR_JOBS)[number];

// 契约只加不改：退役的名字留在 COLLECTOR_JOBS 里，旧调用方点名时回 skipped，不再进定时轮次。
export const RETIRED_COLLECTOR_JOBS = ["vercel-deployments", "vercel-metrics", "avatar-watch"] as const satisfies readonly CollectorJobName[];

export type ActiveCollectorJobName = Exclude<CollectorJobName, (typeof RETIRED_COLLECTOR_JOBS)[number]>;

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
