import type { AgentStatusPayload } from "@shared/agent-status-types";
import type { CloudflareWorkersPayload } from "@shared/cloudflare-workers-types";
import type { ReportersPayload } from "@shared/reporter-ledger";
import type { SentryStatusPayload } from "@shared/sentry-status-types";
import type { SiteDeploymentsPayload } from "@shared/site-deployments-types";
import type {
  ActivityPayload,
  ChargerPayload,
  CodingNowPayload,
  CodingUsagePayload,
  CodingYearPayload,
  DesktopPayload,
  GithubChartPayload,
  GithubRepoPayload,
  ListeningPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  PowerBankPayload,
  PulsePayload,
  ServerPayload,
  TimezonePayload,
  TrophiesPayload,
  TrophiesSummaryPayload,
  WorkoutsPayload,
} from "@shared/types";
import type { AgentLimitsPayload } from "@shared/vibecoding-limits";
import type { NowWatchingPayload, WatchingPayload } from "@shared/emby";
import type { QuestNow } from "@shared/quest";

export type StatusPayloads = {
  desktop: DesktopPayload;
  timezone: TimezonePayload;
  workouts: WorkoutsPayload;
  activity: ActivityPayload;
  server: ServerPayload;
  charger: ChargerPayload;
  powerBank: PowerBankPayload;
  listening: ListeningPayload;
  nowListening: NowListeningPayload;
  coding: CodingUsagePayload;
  codingNow: CodingNowPayload;
  limits: AgentLimitsPayload;
  agentStatus: AgentStatusPayload;
  codingYear: CodingYearPayload;
  watching: WatchingPayload;
  nowWatching: NowWatchingPayload;
  playing: PlaystationPlayingPayload;
  playingNow: PlaystationPresencePayload;
  questNow: QuestNow;
  trophies: TrophiesSummaryPayload | TrophiesPayload;
  githubChart: GithubChartPayload;
  githubRepo: GithubRepoPayload;
  cloudflareWorkers: CloudflareWorkersPayload;
  siteDeployments: SiteDeploymentsPayload;
  sentry: SentryStatusPayload;
  reporters: ReportersPayload;
  pulse: PulsePayload;
};
