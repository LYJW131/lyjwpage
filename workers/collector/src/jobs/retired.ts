import type { Job } from "../job";

// 任务名是跨 Worker 契约（shared/collector.ts）的一部分，只加不改：旧版 ingress 仍可能点名这两个任务。
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
