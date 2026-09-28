/**
 * 公开状态视图的服务端取数表。
 *
 * 和 `status-views.ts` 同一组 key，每个视图一个 `endpoint(params)`。登记表只放
 * 元数据；这里才 import 各 loader。浏览器不能引这个文件（首屏按卡读取走的是
 * HTTP 端点，只引这里的类型）。params 里 `since` / `sinceDate` / `titleIds` 各自
 * 用得上才读，缺席 = 整份。
 */

import { getAgentLimits } from "@/lib/agent-limits";
import { getAgentStatus } from "@/lib/agent-status";
import { getWorkoutsSnapshot } from "@/lib/workouts";
import { getActivitySnapshot } from "@/lib/activity";
import { getChargerSnapshot, sliceChargerHistory } from "@/lib/anker";
import { getRecentlyPlayed } from "@/lib/apple-music-store";
import { getCloudflareWorkers } from "@/lib/cloudflare-workers";
import { getNowWatching, getWatching } from "@/lib/emby";
import { getGithubChart, sliceGithubChart } from "@/lib/github-chart";
import { getGithubRepo } from "@/lib/github-repo";
import { getPlaying, getPlayingNow } from "@/lib/playstation";
import { getPowerBankSnapshot } from "@/lib/powerbank";
import { getPulseStatus } from "@/lib/pulse";
import { getReportersStatus } from "@/lib/reporters";
import { getSentryStatus } from "@/lib/sentry-status";
import { getServerSnapshot } from "@/lib/server";
import type { EndpointViewKey, StatusViewKey } from "@/lib/status-views";
import type { LagResult } from "@/lib/lag-result";
import { getDesktopPayload, getNowListening, getTimezonePayload } from "@/lib/telemetry";
import { getTrophies, sliceTrophies, summarizeTrophies } from "@/lib/trophies";
import { getVercelDeployments } from "@/lib/vercel-deployments";
import { getVibeCodingSnapshot } from "@/lib/vibecoding";
import { getVibeCodingYear } from "@/lib/vibecoding-year-store";

/** 单端点查询参数。缺席 = 整份；`titleIds` 空数组 = 空集。 */
export type StatusLoaderParams = {
  since?: number;
  sinceDate?: string;
  titleIds?: string[];
};

type EndpointLoader = {
  endpoint: (params: StatusLoaderParams) => Promise<unknown>;
};

/** 不读 params 的端点：包一层让签名与 StatusLoaderParams 对齐。 */
function unparam<T>(load: () => Promise<T>): (params: StatusLoaderParams) => Promise<T> {
  return () => load();
}

export const statusLoaders = {
  desktop: { endpoint: unparam(getDesktopPayload) },
  timezone: { endpoint: unparam(getTimezonePayload) },
  workouts: { endpoint: unparam(getWorkoutsSnapshot) },
  activity: { endpoint: unparam(getActivitySnapshot) },
  server: { endpoint: unparam(getServerSnapshot) },
  charger: {
    endpoint: async ({ since }: StatusLoaderParams) =>
      sliceChargerHistory(await getChargerSnapshot(), since),
  },
  powerBank: { endpoint: unparam(getPowerBankSnapshot) },
  listening: { endpoint: unparam(getRecentlyPlayed) },
  nowListening: { endpoint: unparam(getNowListening) },
  vibeCoding: { endpoint: unparam(getVibeCodingSnapshot) },
  limits: { endpoint: unparam(getAgentLimits) },
  agentStatus: { endpoint: unparam(getAgentStatus) },
  vibeCodingYear: { endpoint: unparam(getVibeCodingYear) },
  watching: { endpoint: unparam(getWatching) },
  nowWatching: { endpoint: unparam(getNowWatching) },
  playing: { endpoint: unparam(getPlaying) },
  playingNow: { endpoint: unparam(getPlayingNow) },
  /**
   * 无参是摘要（和首屏字段、`trophies` 推送同一个形状），带 `?titleids=` 是那几款的
   * 完整目录切片。整份目录几百 KB，没有谁需要一次拿全，所以不再有「裸读整份」这一档。
   */
  trophies: {
    endpoint: async ({ titleIds }: StatusLoaderParams) => {
      const data = await getTrophies();
      return titleIds == null ? summarizeTrophies(data) : sliceTrophies(data, titleIds);
    },
  },
  githubChart: {
    endpoint: async ({ sinceDate }: StatusLoaderParams) =>
      sliceGithubChart(await getGithubChart(), sinceDate),
  },
  githubRepo: { endpoint: unparam(getGithubRepo) },
  cloudflareWorkers: { endpoint: unparam(getCloudflareWorkers) },
  vercelDeployments: { endpoint: unparam(getVercelDeployments) },
  sentry: { endpoint: unparam(getSentryStatus) },
  reporters: { endpoint: unparam(getReportersStatus) },
  pulse: { endpoint: unparam(() => getPulseStatus()) },
} satisfies { [K in StatusViewKey]: EndpointLoader };

export type StatusLoaders = typeof statusLoaders;
export type StatusLoaderKey = keyof StatusLoaders;

type EndpointValue<L> = L extends { endpoint: (params: StatusLoaderParams) => Promise<infer E> }
  ? E extends LagResult<infer D> ? D : E
  : never;

/**
 * 各端点无参时的裸 payload 类型（尚未包信封）。trophies 无参回摘要，这里按实现
 * 推断成摘要与目录的并集，首屏那格由调用方收窄。
 */
export type EndpointPayloadOf<K extends StatusLoaderKey> = EndpointValue<StatusLoaders[K]>;

/** 按登记表的 path 取数。返回 unknown：各端点 payload 形状不同，信封层再包。 */
export function loadEndpoint(key: EndpointViewKey, params: StatusLoaderParams = {}): Promise<unknown> {
  const endpoint: (args: StatusLoaderParams) => Promise<unknown> = statusLoaders[key].endpoint;
  return endpoint(params);
}
