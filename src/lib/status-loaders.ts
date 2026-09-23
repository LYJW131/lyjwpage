/**
 * 公开状态视图的服务端取数表。
 *
 * 和 `status-views.ts` 同一组 key（除 `lyrics`：歌词按 nowListening 的 songId 现解）。
 * 登记表只放元数据；这里才 import 各 loader。浏览器不能引这个文件。
 *
 * - `endpoint(params)`：单端点。有 path 的视图必有。params 里 `since` /
 *   `sinceDate` / `titleIds` 各自用得上才读，缺席 = 整份。
 * - `home()`：首屏字段与无参端点不同时才写（trophies 摘要、charger 20 分钟窗）。
 *   没写的视图，`/api/home` 调 `endpoint({})`。
 * - `timezone` 只有 home，没有端点。
 */

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
import { STATUS_VIEWS, type EndpointViewKey, type StatusViewKey } from "@/lib/status-views";
import { getDesktopPayload, getNowListening, getTimezonePayload } from "@/lib/telemetry";
import { getTrophies, getTrophiesSummary, sliceTrophies } from "@/lib/trophies";
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
  home?: () => Promise<unknown>;
};

type HomeOnlyLoader = {
  home: () => Promise<unknown>;
};

type LoaderFor<K extends Exclude<StatusViewKey, "lyrics">> =
  (typeof STATUS_VIEWS)[K] extends { path: string } ? EndpointLoader : HomeOnlyLoader;

/** 首屏充电曲线只画最近 20 分钟，完整 400 点留在单端点。 */
const CHARGER_HOME_WINDOW_MS = 20 * 60_000;

async function chargerHome() {
  const payload = await getChargerSnapshot();
  const { history } = payload;
  if (history.length < 2) return payload;

  const end = history[history.length - 1].t;
  const firstInside = history.findIndex(
    (sample) => sample.t >= end - CHARGER_HOME_WINDOW_MS,
  );
  if (firstInside <= 0) return payload;

  return { ...payload, history: history.slice(firstInside - 1) };
}

/** 不读 params 的端点：包一层让签名与 StatusLoaderParams 对齐。 */
function unparam<T>(load: () => Promise<T>): (params: StatusLoaderParams) => Promise<T> {
  return () => load();
}

export const statusLoaders = {
  desktop: { endpoint: unparam(getDesktopPayload) },
  timezone: { home: getTimezonePayload },
  workouts: { endpoint: unparam(getWorkoutsSnapshot) },
  activity: { endpoint: unparam(getActivitySnapshot) },
  server: { endpoint: unparam(getServerSnapshot) },
  charger: {
    endpoint: async ({ since }: StatusLoaderParams) =>
      sliceChargerHistory(await getChargerSnapshot(), since),
    home: chargerHome,
  },
  powerBank: { endpoint: unparam(getPowerBankSnapshot) },
  listening: { endpoint: unparam(getRecentlyPlayed) },
  nowListening: { endpoint: unparam(getNowListening) },
  vibeCoding: { endpoint: unparam(getVibeCodingSnapshot) },
  agentStatus: { endpoint: unparam(getAgentStatus) },
  vibeCodingYear: { endpoint: unparam(getVibeCodingYear) },
  watching: { endpoint: unparam(getWatching) },
  nowWatching: { endpoint: unparam(getNowWatching) },
  playing: { endpoint: unparam(getPlaying) },
  playingNow: { endpoint: unparam(getPlayingNow) },
  trophies: {
    endpoint: async ({ titleIds }: StatusLoaderParams) => {
      const data = await getTrophies();
      return titleIds == null ? data : sliceTrophies(data, titleIds);
    },
    home: getTrophiesSummary,
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
} satisfies { [K in Exclude<StatusViewKey, "lyrics">]: LoaderFor<K> };

export type StatusLoaders = typeof statusLoaders;
export type StatusLoaderKey = keyof StatusLoaders;

type HomeValue<L> = L extends { home: () => Promise<infer H> }
  ? H
  : L extends { endpoint: (params: StatusLoaderParams) => Promise<infer E> }
    ? E
    : never;

/** `/api/home` 各字段的裸 payload 类型（尚未包信封） */
export type HomePayloadOf<K extends StatusLoaderKey> = HomeValue<StatusLoaders[K]>;

export function hasEndpoint(
  loader: StatusLoaders[StatusLoaderKey],
): loader is StatusLoaders[StatusLoaderKey] & EndpointLoader {
  return "endpoint" in loader;
}

/** 按登记表的 path 取数。返回 unknown：各端点 payload 形状不同，信封层再包。 */
export function loadEndpoint(key: EndpointViewKey, params: StatusLoaderParams = {}): Promise<unknown> {
  const loader = statusLoaders[key];
  if (!hasEndpoint(loader)) {
    throw new Error(`status view "${key}" has no endpoint`);
  }
  const endpoint: (args: StatusLoaderParams) => Promise<unknown> = loader.endpoint;
  return endpoint(params);
}

/** 首屏取数：有 home 覆盖用 home，否则 `endpoint({})` */
export function homeLoader<K extends StatusLoaderKey>(
  key: K,
): () => Promise<HomePayloadOf<K>> {
  const loader = statusLoaders[key];
  if ("home" in loader && loader.home) {
    return loader.home as () => Promise<HomePayloadOf<K>>;
  }
  return () =>
    (loader as { endpoint: (params: StatusLoaderParams) => Promise<HomePayloadOf<K>> }).endpoint(
      {},
    );
}
