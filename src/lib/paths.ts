import { STATUS_VIEWS } from "@/lib/status-views";

/**
 * 各卡 SWR 键，值来自登记表（lib/status-views）。
 * 推送写入和轮询读取必须是同一个字符串，全站只从这里取，别在组件里手写。
 */

export const DESKTOP_PATH = STATUS_VIEWS.desktop.path;
export const CHARGER_PATH = STATUS_VIEWS.charger.path;
export const POWERBANK_PATH = STATUS_VIEWS.powerBank.path;
export const VIBECODING_PATH = STATUS_VIEWS.vibeCoding.path;
export const VIBECODING_YEAR_PATH = STATUS_VIEWS.vibeCodingYear.path;
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
export const WORKOUTS_PATH = STATUS_VIEWS.workouts.path;
export const SERVER_PATH = STATUS_VIEWS.server.path;
export const VERCEL_DEPLOYMENTS_PATH = STATUS_VIEWS.vercelDeployments.path;
export const PULSE_PATH = STATUS_VIEWS.pulse.path;

/**
 * 一块瓷砖要的那几款奖杯。同样是 SWR 键（每块打开过的瓷砖各一个）。
 * titleId 先排序：同一块瓷砖的 titleIds 顺序跟着最近游玩列表走，列表一重排
 * 就会拼出另一个键，同一份数据被取第二遍、面板还闪一下加载态。
 */
export function trophiesTilePath(titleIds: string[]): string {
  const ids = [...titleIds].sort().join(",");
  return `${TROPHIES_PATH}?titleids=${encodeURIComponent(ids)}`;
}
