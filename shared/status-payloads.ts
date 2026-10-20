import type { AgentStatusPayload } from "@shared/agent-status-types";
import type { CloudflareWorkersPayload } from "@shared/cloudflare-workers-types";
import type { DigestPayload } from "@shared/digest";
import type { ReportersPayload } from "@shared/reporter-ledger";
import type { HealthPayload } from "@shared/health-types";
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
import type { LimitHistoryPayload } from "@shared/limit-history";
import type { NowWatchingPayload, WatchingPayload } from "@shared/emby";
import type { FocusNow } from "@shared/focus";
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
  limitsHistory: LimitHistoryPayload;
  agentStatus: AgentStatusPayload;
  codingYear: CodingYearPayload;
  watching: WatchingPayload;
  nowWatching: NowWatchingPayload;
  playing: PlaystationPlayingPayload;
  playingNow: PlaystationPresencePayload;
  questNow: QuestNow;
  focusNow: FocusNow;
  trophies: TrophiesSummaryPayload | TrophiesPayload;
  githubChart: GithubChartPayload;
  githubRepo: GithubRepoPayload;
  cloudflareWorkers: CloudflareWorkersPayload;
  siteDeployments: SiteDeploymentsPayload;
  health: HealthPayload;
  reporters: ReportersPayload;
  pulse: PulsePayload;
  digest: DigestPayload;
};
