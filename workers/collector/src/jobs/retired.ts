import type { Job } from "../job";

export const vercelDeploymentsJob: Job = {
  name: "vercel-deployments",
  everyMinutes: 1,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run() {
    return { status: "skipped", detail: "Retired deployment provider" };
  },
};

export const vercelMetricsJob: Job = {
  name: "vercel-metrics",
  everyMinutes: 15,
  offset: 3,
  maxRuntimeMinutes: 2,
  async run() {
    return { status: "skipped", detail: "Retired deployment provider" };
  },
};
