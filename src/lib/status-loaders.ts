
import { getAgentLimits } from "@/lib/agent-limits";
import { getAgentStatus } from "@/lib/agent-status";
import { getWorkoutsSnapshot } from "@/lib/workouts";
import { getActivitySnapshot } from "@/lib/activity";
import { getChargerSnapshot, sliceChargerHistory } from "@/lib/anker";
import { getRecentlyPlayed } from "@/lib/apple-music-store";
import { getCloudflareWorkers } from "@/lib/cloudflare-workers";
import { getCodingNow, getCodingUsage, getCodingYear } from "@/lib/coding-usage";
import { getNowWatching, getWatching } from "@/lib/emby";
import { getGithubChart, sliceGithubChart } from "@/lib/github-chart";
import { getGithubRepo } from "@/lib/github-repo";
import { getGenshinProfile } from "@/lib/genshin";
import { getPlaying, getPlayingNow } from "@/lib/playstation";
import { getQuestNow } from "@/lib/quest";
import { getPowerBankSnapshot } from "@/lib/powerbank";
import { getPulseStatus } from "@/lib/pulse";
import { getReportersStatus } from "@/lib/reporters";
import { getSentryStatus } from "@/lib/sentry-status";
import { getServerSnapshot } from "@/lib/server";
import type { EndpointViewKey, StatusViewKey } from "@/lib/status-views";
import type { LagResult } from "@/lib/lag-result";
import { getDesktopPayload, getNowListening, getTimezonePayload } from "@/lib/telemetry";
import { getTrophies, summarizeTrophies } from "@/lib/trophies";
import { sliceTrophies } from "@/lib/trophy-slice";
import { getVercelDeployments } from "@/lib/vercel-deployments";

export type StatusLoaderParams = {
  since?: number;
  sinceDate?: string;
  titleIds?: string[];
};

type EndpointLoader = {
  endpoint: (params: StatusLoaderParams) => Promise<unknown>;
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
  vercelDeployments: { endpoint: unparam(getVercelDeployments) },
  sentry: { endpoint: unparam(getSentryStatus) },
  genshin: { endpoint: unparam(getGenshinProfile) },
  reporters: { endpoint: unparam(getReportersStatus) },
  pulse: { endpoint: unparam(() => getPulseStatus()) },
} satisfies { [K in StatusViewKey]: EndpointLoader };

export type StatusLoaders = typeof statusLoaders;
export type StatusLoaderKey = keyof StatusLoaders;

type EndpointValue<L> = L extends { endpoint: (params: StatusLoaderParams) => Promise<infer E> }
  ? E extends LagResult<infer D> ? D : E
  : never;

export type EndpointPayloadOf<K extends StatusLoaderKey> = EndpointValue<StatusLoaders[K]>;

export function loadEndpoint(key: EndpointViewKey, params: StatusLoaderParams = {}): Promise<unknown> {
  const endpoint: (args: StatusLoaderParams) => Promise<unknown> = statusLoaders[key].endpoint;
  return endpoint(params);
}
