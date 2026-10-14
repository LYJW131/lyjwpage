import { getAgentStatus } from "@shared/agent-status";
import { AwaitingReport } from "@shared/awaiting-report";
import { getCloudflareWorkers } from "@shared/cloudflare-workers";
import { publicDigest, type DigestPayload, type DigestRecord } from "@shared/digest";
import { localDate } from "@shared/freshness";
import { getGithubChart, sliceGithubChart } from "@shared/github-chart";
import { getGithubRepo } from "@shared/github-repo";
import { getCorsHeaders, isForeignOrigin, jsonResponse, type OriginEnv } from "@shared/http-origins";
import { LAG_KEYS, readLagEntry } from "@shared/lag";
import { LagResult, loadLag } from "@shared/lag-result";
import type { ReporterStat, ReportersPayload } from "@shared/reporter-ledger";
import { getHealth } from "@shared/health";
import { publicServer } from "@shared/server";
import { getSiteDeployments } from "@shared/site-deployments";
import type { StatusPayloads } from "@shared/status-payloads";
import {
  loaderParams,
  statusEnvelope,
  statusResponse,
  withPublicCors,
  type StatusLoaderParams,
} from "@shared/status-response";
import type { LagViewKey } from "@shared/status-views";
import type {
  ActivityPayload,
  ActivityStatus,
  ServerPayload,
  StatusResponse,
  TimezoneActivity,
  TimezonePayload,
  Workout,
  WorkoutsPayload,
} from "@shared/types";
import type { AgentLimitsPayload } from "@shared/vibecoding-limits";
import { publicWorkout } from "@shared/workouts";

export async function getTimezonePayload(): Promise<TimezonePayload | LagResult<TimezonePayload>> {
  const entry = await readLagEntry<{ timezone: TimezoneActivity | null }>(LAG_KEYS.timezone);
  const payload = { timezone: entry?.data.timezone ?? null, snapshotAt: Date.now() };
  return entry ? new LagResult(payload, entry.updatedAt) : payload;
}

export async function getWorkoutsSnapshot(): Promise<LagResult<WorkoutsPayload>> {
  const stored = await loadLag<{ items: Workout[] }>(LAG_KEYS.workouts, "Awaiting workout report");
  return stored.map(({ items }) => ({ items: items.map(publicWorkout), pushedAt: stored.updatedAt }));
}

// 跨日失效必须在取数时计算；缓存中的昨天满环不能继续代表今天。
export function withActivityFreshness(
  payload: ActivityPayload,
  now = Date.now(),
): ActivityPayload {
  return {
    ...payload,
    currentAtSource: localDate(now, payload.secondsFromGMT) === payload.date,
  };
}

export async function getActivitySnapshot(): Promise<LagResult<ActivityPayload>> {
  const stored = await loadLag<ActivityStatus>(LAG_KEYS.activity, "尚未收到活动圆环上报");
  return stored.map((activity) => withActivityFreshness({ ...activity, pushedAt: stored.updatedAt, currentAtSource: true }));
}

export async function getServerSnapshot(): Promise<LagResult<ServerPayload>> {
  const stored = await loadLag<ServerPayload>(LAG_KEYS.server, "尚未收到落地节点上报");
  return stored.map((data) => ({ ...publicServer(data), pushedAt: data.pushedAt }));
}

export function getAgentLimits(): Promise<LagResult<AgentLimitsPayload>> {
  return loadLag<AgentLimitsPayload>(LAG_KEYS.limits, "尚未收到限额上报");
}

export async function getReportersStatus(): Promise<LagResult<ReportersPayload>> {
  const [server, agents] = await Promise.all([
    readLagEntry<ReporterStat>(LAG_KEYS.reporterServer),
    readLagEntry<ReporterStat>(LAG_KEYS.reporterAgents),
  ]);
  if (!server && !agents) throw new AwaitingReport("尚未收到常驻上报器的账本");
  return new LagResult(
    { reporters: { "server-reporter": server?.data ?? null, "agents-reporter": agents?.data ?? null } },
    Math.max(server?.updatedAt ?? 0, agents?.updatedAt ?? 0),
  );
}

export async function getDigest(): Promise<LagResult<DigestPayload>> {
  return (await loadLag<DigestRecord>(LAG_KEYS.digest, "Awaiting first digest")).map(publicDigest);
}

type LagViewLoader<T> = (params: StatusLoaderParams) => Promise<T | LagResult<T>>;

export const LAG_VIEW_LOADERS = {
  timezone: getTimezonePayload,
  workouts: getWorkoutsSnapshot,
  activity: getActivitySnapshot,
  server: getServerSnapshot,
  limits: getAgentLimits,
  agentStatus: getAgentStatus,
  githubChart: async ({ sinceDate }: StatusLoaderParams) =>
    (await getGithubChart()).map((chart) => sliceGithubChart(chart, sinceDate)),
  githubRepo: getGithubRepo,
  cloudflareWorkers: getCloudflareWorkers,
  siteDeployments: getSiteDeployments,
  health: getHealth,
  reporters: getReportersStatus,
  digest: getDigest,
} satisfies { [K in LagViewKey]: LagViewLoader<StatusPayloads[K]> };

export function lagEnvelope(view: LagViewKey, params: StatusLoaderParams = {}): Promise<StatusResponse<unknown>> {
  const loader: LagViewLoader<unknown> = LAG_VIEW_LOADERS[view];
  return statusEnvelope(() => loader(params));
}

// 与 core 的 /api/* 同口径：带了 Origin 且不在名单里回 403，其余照常回公开模型。
export async function serveLagStatus(request: Request, view: LagViewKey, env: OriginEnv): Promise<Response> {
  const cors = getCorsHeaders(request, env);
  if (isForeignOrigin(request, env)) return jsonResponse({ ok: false }, { status: 403, headers: cors });
  return withPublicCors(statusResponse(await lagEnvelope(view, loaderParams(request))), cors);
}
