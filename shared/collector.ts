import type { PlayingQueueTrack } from "@shared/playing-queue";
import type { EnrichmentFollowUp, EnrichmentOutcome } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

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
  "uptime-probe",
  "site-health",
  "digest",
] as const;

export type CollectorJobName = (typeof COLLECTOR_JOBS)[number];

// 契约只加不改：退役的名字留在 COLLECTOR_JOBS 里，旧调用方点名时回 skipped，不再进定时轮次。
export const RETIRED_COLLECTOR_JOBS = ["vercel-deployments", "vercel-metrics", "avatar-watch", "sentry-status"] as const satisfies readonly CollectorJobName[];

export type ActiveCollectorJobName = Exclude<CollectorJobName, (typeof RETIRED_COLLECTOR_JOBS)[number]>;

export const ACTIVE_COLLECTOR_JOBS: readonly ActiveCollectorJobName[] = COLLECTOR_JOBS.filter(
  (name): name is ActiveCollectorJobName => !(RETIRED_COLLECTOR_JOBS as readonly string[]).includes(name),
);

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
  // 上报提交前补全 Apple 目录、动态封面与队列 ID；music 为空、已停止或没有标题时回 null。每段各自限时，没查出的段记为未知，不抛错。
  enrichTrack(music: LocalNowPlaying | null, upcomingTracks: PlayingQueueTrack[]): Promise<EnrichmentOutcome | null>;
  // 提交成功后调：预热歌词，写入时没查全的整份重查，查到更多就经 StateCore.commitEnrichmentPatch 补写。调用立即返回，其余在采集 Worker 的 waitUntil 里跑。
  followUpTrack(followUp: EnrichmentFollowUp): Promise<void>;
}
