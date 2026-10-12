
import { getAgentLimits } from "./agent-limits";
import { getAgentStatus } from "@shared/agent-status";
import { getWorkoutsSnapshot } from "./workouts";
import { getActivitySnapshot } from "./activity";
import { getChargerSnapshot, sliceChargerHistory } from "./anker";
import { getRecentlyPlayed } from "./apple-music-store";
import { getCloudflareWorkers } from "@shared/cloudflare-workers";
import { getCodingNow, getCodingUsage, getCodingYear } from "./coding-usage";
import { getNowWatching, getWatching } from "./emby";
import { getGithubChart, sliceGithubChart } from "@shared/github-chart";
import { getGithubRepo } from "@shared/github-repo";
import { getPlaying, getPlayingNow, getTrophies } from "./playstation";
import { getQuestNow } from "./quest";
import { getPowerBankSnapshot } from "./powerbank";
import { getPulseStatus } from "./pulse";
import { getReportersStatus } from "./reporters";
import { getHealth } from "@shared/health";
import { getServerSnapshot } from "./server";
import type { EndpointViewKey, StatusViewKey } from "@shared/status-views";
import type { LagResult } from "@shared/lag-result";
import type { StatusPayloads } from "@shared/status-payloads";
import { getDesktopPayload, getNowListening, getTimezonePayload } from "./telemetry";
import { summarizeTrophies } from "@shared/trophies";
import { sliceTrophies } from "@shared/trophy-slice";
import { getSiteDeployments } from "@shared/site-deployments";

export type StatusLoaderParams = {
  since?: number;
  sinceDate?: string;
  titleIds?: string[];
};

type EndpointLoader<T> = {
  endpoint: (params: StatusLoaderParams) => Promise<T | LagResult<T>>;
};

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
  coding: { endpoint: unparam(getCodingUsage) },
  codingNow: { endpoint: unparam(getCodingNow) },
  limits: { endpoint: unparam(getAgentLimits) },
  agentStatus: { endpoint: unparam(getAgentStatus) },
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
  githubChart: {
    endpoint: async ({ sinceDate }: StatusLoaderParams) =>
      (await getGithubChart()).map((chart) => sliceGithubChart(chart, sinceDate)),
  },
  githubRepo: { endpoint: unparam(getGithubRepo) },
  cloudflareWorkers: { endpoint: unparam(getCloudflareWorkers) },
  siteDeployments: { endpoint: unparam(getSiteDeployments) },
  health: { endpoint: unparam(getHealth) },
  reporters: { endpoint: unparam(getReportersStatus) },
  pulse: { endpoint: unparam(() => getPulseStatus()) },
} satisfies { [K in StatusViewKey]: EndpointLoader<StatusPayloads[K]> };

export function loadEndpoint(key: EndpointViewKey, params: StatusLoaderParams = {}): Promise<unknown> {
  const endpoint: (args: StatusLoaderParams) => Promise<unknown> = statusLoaders[key].endpoint;
  return endpoint(params);
}
