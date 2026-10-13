import { getChargerSnapshot, sliceChargerHistory } from "./anker";
import { getRecentlyPlayed } from "./apple-music-store";
import { getCodingNow, getCodingUsage, getCodingYear } from "./coding-usage";
import { getNowWatching, getWatching } from "./emby";
import { getPlaying, getPlayingNow, getTrophies } from "./playstation";
import { getQuestNow } from "./quest";
import { getPowerBankSnapshot } from "./powerbank";
import { getPulseStatus } from "./pulse";
import { LAG_VIEW_LOADERS } from "@shared/lag-views";
import type { EndpointViewKey, StatusViewKey } from "@shared/status-views";
import type { LagResult } from "@shared/lag-result";
import type { StatusPayloads } from "@shared/status-payloads";
import type { StatusLoaderParams } from "@shared/status-response";
import { getDesktopPayload, getNowListening } from "./telemetry";
import { summarizeTrophies } from "@shared/trophies";
import { sliceTrophies } from "@shared/trophy-slice";

type EndpointLoader<T> = {
  endpoint: (params: StatusLoaderParams) => Promise<T | LagResult<T>>;
};

function unparam<T>(load: () => Promise<T>): (params: StatusLoaderParams) => Promise<T> {
  return () => load();
}

export const statusLoaders = {
  desktop: { endpoint: unparam(getDesktopPayload) },
  timezone: { endpoint: LAG_VIEW_LOADERS.timezone },
  workouts: { endpoint: LAG_VIEW_LOADERS.workouts },
  activity: { endpoint: LAG_VIEW_LOADERS.activity },
  server: { endpoint: LAG_VIEW_LOADERS.server },
  charger: {
    endpoint: async ({ since }: StatusLoaderParams) =>
      sliceChargerHistory(await getChargerSnapshot(), since),
  },
  powerBank: { endpoint: unparam(getPowerBankSnapshot) },
  listening: { endpoint: unparam(getRecentlyPlayed) },
  nowListening: { endpoint: unparam(getNowListening) },
  coding: { endpoint: unparam(getCodingUsage) },
  codingNow: { endpoint: unparam(getCodingNow) },
  limits: { endpoint: LAG_VIEW_LOADERS.limits },
  agentStatus: { endpoint: LAG_VIEW_LOADERS.agentStatus },
  codingYear: { endpoint: unparam(getCodingYear) },
  watching: { endpoint: unparam(getWatching) },
  nowWatching: { endpoint: unparam(getNowWatching) },
  playing: { endpoint: unparam(getPlaying) },
  playingNow: { endpoint: unparam(getPlayingNow) },
  questNow: { endpoint: unparam(getQuestNow) },
  trophies: {
    endpoint: async ({ titleIds }: StatusLoaderParams) => {
      const data = await getTrophies();
      return titleIds == null ? summarizeTrophies(data) : sliceTrophies(data, titleIds);
    },
  },
  githubChart: { endpoint: LAG_VIEW_LOADERS.githubChart },
  githubRepo: { endpoint: LAG_VIEW_LOADERS.githubRepo },
  cloudflareWorkers: { endpoint: LAG_VIEW_LOADERS.cloudflareWorkers },
  siteDeployments: { endpoint: LAG_VIEW_LOADERS.siteDeployments },
  sentry: { endpoint: LAG_VIEW_LOADERS.sentry },
  reporters: { endpoint: LAG_VIEW_LOADERS.reporters },
  pulse: { endpoint: unparam(() => getPulseStatus()) },
} satisfies { [K in StatusViewKey]: EndpointLoader<StatusPayloads[K]> };

export function loadEndpoint(key: EndpointViewKey, params: StatusLoaderParams = {}): Promise<unknown> {
  const endpoint: (args: StatusLoaderParams) => Promise<unknown> = statusLoaders[key].endpoint;
  return endpoint(params);
}
