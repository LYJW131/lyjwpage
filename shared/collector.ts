/**
 * 采集 Worker（workers/collector）对内公开的 RPC 契约。
 *
 * 同账号的 Worker 经 Service Binding 调它的具名 entrypoint `Collector`，比如上报入口
 * 在站点部署完成后让它立刻重拉部署列表，而不是等下一次 cron。只放类型和任务名，
 * 调用方和实现方各自 import。方法只能加不能改：两边分开部署，新方法先随采集 Worker 上线。
 */

/** 登记在采集 Worker 里的全部任务，节奏与去向见 workers/collector/README.md */
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

/**
 * 一个任务跑完的结果。`skipped` 是正常跳过（缺令牌、门没开、退避中），
 * `error` 带着原因；不认识的任务名同样是 `error`，不抛。
 */
export type CollectorJobOutcome = {
  job: string;
  status: "ok" | "skipped" | "error";
  detail?: string;
  /** 墙钟耗时，毫秒 */
  ms: number;
};

export interface CollectorRpc {
  /** 立刻跑这几个任务（不看节奏），各自独立，一个失败不连累别的 */
  refresh(jobs: string[]): Promise<CollectorJobOutcome[]>;
}
