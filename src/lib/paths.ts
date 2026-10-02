import { STATUS_VIEWS } from "@/lib/status-views";


export const DESKTOP_PATH = STATUS_VIEWS.desktop.path;
export const CHARGER_PATH = STATUS_VIEWS.charger.path;
export const POWERBANK_PATH = STATUS_VIEWS.powerBank.path;
export const LIMITS_PATH = STATUS_VIEWS.limits.path;
export const AGENT_STATUS_PATH = STATUS_VIEWS.agentStatus.path;
export const CODING_PATH = STATUS_VIEWS.coding.path;
export const CODING_NOW_PATH = STATUS_VIEWS.codingNow.path;
export const CODING_YEAR_PATH = STATUS_VIEWS.codingYear.path;
export const LISTENING_PATH = STATUS_VIEWS.listening.path;
export const NOW_LISTENING_PATH = STATUS_VIEWS.nowListening.path;
export const WATCHING_PATH = STATUS_VIEWS.watching.path;
export const NOW_WATCHING_PATH = STATUS_VIEWS.nowWatching.path;
export const PLAYING_PATH = STATUS_VIEWS.playing.path;
export const NOW_PLAYING_PATH = STATUS_VIEWS.playingNow.path;
export const TROPHIES_PATH = STATUS_VIEWS.trophies.path;
export const GITHUB_CHART_PATH = STATUS_VIEWS.githubChart.path;
export const GITHUB_REPO_PATH = STATUS_VIEWS.githubRepo.path;
export const CLOUDFLARE_WORKERS_PATH = STATUS_VIEWS.cloudflareWorkers.path;
export const ACTIVITY_PATH = STATUS_VIEWS.activity.path;
export const SERVER_PATH = STATUS_VIEWS.server.path;
export const VERCEL_DEPLOYMENTS_PATH = STATUS_VIEWS.vercelDeployments.path;
export const SENTRY_PATH = STATUS_VIEWS.sentry.path;
export const REPORTERS_PATH = STATUS_VIEWS.reporters.path;
export const PULSE_PATH = STATUS_VIEWS.pulse.path;

// 同组 titleIds 的顺序变化不应生成新缓存键，必须先排序。
export function trophiesTilePath(titleIds: readonly string[]): string {
  const ids = [...titleIds].sort().join(",");
  return `${TROPHIES_PATH}?titleids=${encodeURIComponent(ids)}`;
}
