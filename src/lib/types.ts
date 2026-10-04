
export type WatchingItem = {
  id: string;
  title: string;
  subtitle: string;
  progress: number;
  poster: string | null;
  backdrop: string | null;
  type: "Episode" | "Movie" | "Series" | "Other";
  year: number | null;
  link: string | null;
  playedAt: string | null;
};

export type WatchingMedia = {
  container: string | null;
  bitrate: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    range: "sdr" | "hdr" | "hdr10" | "hdr10plus" | "dolby-vision" | "hlg" | null;
    bitDepth: number | null;
  } | null;
  audio: {
    codec: string | null;
    profile: string | null;
    channels: number | null;
    layout: string | null;
    language: string | null;
  } | null;
  subtitle: {
    codec: string | null;
    language: string | null;
    title: string | null;
    forced: boolean;
    external: boolean;
  } | null;
};

export type WatchingPlayMethod = "directplay" | "directstream" | "transcode";

export type PlaystationGame = {
  titleId: string;
  name: string;
  category: string | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  playDurationMs: number | null;
  imageUrl: string | null;
  service: string | null;
  preOrder: boolean;
};

export type PlaystationPlayingPayload = {
  observedAt: number;
  items: PlaystationGame[];
};

export type PlaystationNowPlaying = {
  titleId: string;
  title: string;
  format: string | null;
  launchPlatform: string | null;
  iconUrl: string | null;
};

export type PlaystationPowerPayload = {
  on: boolean;
  observedAt: number;
  entityId: string | null;
};

export type PlaystationPresencePayload = {
  observedAt: number;
  online: boolean;
  availability: string | null;
  platform: string | null;
  lastOnlineAt: number | null;
  playing: PlaystationNowPlaying | null;
};

export const TROPHY_TYPES = ["platinum", "gold", "silver", "bronze"] as const;
export type TrophyType = (typeof TROPHY_TYPES)[number];

export type TrophyCounts = {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type TrophyProfile = {
  onlineId: string;
  avatarUrl: string | null;
  plus: boolean;
  level: number;
  tier: number;
  trophyPoint: number;
  levelBasePoint: number;
  levelNextPoint: number;
  levelProgress: number;
  earned: TrophyCounts;
};

export type TrophyGroup = {
  id: string;
  name: string;
  iconUrl: string | null;
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
};

export type Trophy = {
  id: number;
  type: TrophyType;
  name: string;
  detail: string | null;
  iconUrl: string | null;
  hidden: boolean;
  groupId: string;
  earned: boolean;
  earnedAt: number | null;
  earnedRate: number | null;
};

export type TrophyTitle = {
  npCommunicationId: string;
  name: string;
  localizedName: string | null;
  titleIds: string[];
  iconUrl: string | null;
  platform: string;
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
  lastUpdatedAt: number | null;
  playDurationMs: number | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  service: string | null;
  preOrder: boolean;
  groups: TrophyGroup[];
  trophies: Trophy[];
};

export type TrophiesPayload = {
  observedAt: number;
  profile: TrophyProfile;
  titles: TrophyTitle[];
};

export type TrophyUnlock = {
  npCommunicationId: string;
  id: number;
  groupId: string;
  titleName: string;
  trophyName: string;
  type: TrophyType;
  iconUrl: string | null;
  earnedAt: number;
};

export type TrophyTitleDigest = {
  npCommunicationId: string;
  name: string;
  localizedName: string | null;
  titleIds: string[];
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
};

export type TrophiesSummaryPayload = {
  observedAt: number;
  profile: TrophyProfile;
  earned: TrophyCounts;
  recent: TrophyUnlock[];
  titles: TrophyTitleDigest[];
};

export type ListeningItem = {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  link: string | null;
  palette: string[];
  durationMs: number | null;
  motion?: TrackMotion | null;
};

export type TrackMotion = {
  videoUrl: string;
  colors: string[] | null;
};

export type RecentTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs?: number | null;
  songId?: string | null;
  artworkUrl?: string | null;
};

// Apple「最近播放」最前那个歌单 / 专辑里可播的歌，按容器里的顺序。id 是资源 id（同 ListeningItem.id）。
export type PlayingContainer = {
  id: string;
  tracks: PlayingContainerTrack[];
};

export type PlayingContainerTrack = Pick<RecentTrack, "id" | "title" | "artist"> & {
  songId: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
};

export type ReporterPresence = {
  lastSeenAt: number;
  declaredOffline: boolean;
  heartbeatWindowMs: number;
};

export type ListeningPayload = {
  items: ListeningItem[];
  fetchedAt: number;
};

export const HIDDEN_DESKTOP_BUNDLE_ID =
  "com.liangyangjunwei.MacTelemetryHub.hidden";

export type DesktopActivity = {
  applicationName: string;
  bundleIdentifier: string | null;
  windowTitle: string | null;
  iconUrl: string | null;
  observedAt: number;
};

export type LocalNowPlaying = {
  source: "apple-music" | "homepod";
  state: "playing" | "paused" | "stopped";
  title: string | null;
  artist: string | null;
  album: string | null;
  trackId: string | null;
  artworkUrl: string | null;
  positionMs: number;
  durationMs: number;
  repeatOne: boolean;
  observedAt: number;
};

export type DesktopPayload = ReporterPresence & {
  desktop: DesktopActivity | null;
  receivedAt: number | null;
};

export type TimezoneActivity = {
  identifier: string;
  abbreviation: string | null;
  secondsFromGMT: number;
  observedAt: number;
};

export type TimezonePayload = {
  timezone: TimezoneActivity | null;
  snapshotAt: number;
};

export type NowListeningAlternate = {
  music: LocalNowPlaying;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
};

export type NowListeningPayload = ReporterPresence & {
  music: LocalNowPlaying | null;
  receivedAt: number | null;
  idle: boolean;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
  expiresInMs: number | null;
  alternate: NowListeningAlternate | null;
  // 没有上报器的 Apple Music 播放（iPhone、iPad、网页版等）推断出来正在放的那首；Mac / HomePod 在放同名歌时为 null。可能缺席（Worker 先后上线）。
  elsewhere?: NowListeningElsewhere | null;
};

// startedAt 是推断的开播 epoch 毫秒，marginMs 是它的理想误差半宽（连续播放、上榜滞后恒定时）；放到 startedAt + durationMs 为止，
// 之后再给 LISTENING_ELSEWHERE_HOLD_MS 等下一首被看见。
export type NowListeningElsewhere = {
  title: string;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  songId: string | null;
  startedAt: number;
  durationMs: number;
  marginMs: number;
  // 照规则推出的下一首；随机播放或证据不够时为 null。可能缺席（Worker 先后上线）。
  next?: NowListeningNext | null;
};

// basis：loop 是最近几首按同样顺序完整重复过一轮，order 是正按所在歌单 / 专辑的顺序往下放。
export type NowListeningNext = {
  title: string;
  artist: string | null;
  songId: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  basis: "loop" | "order";
};

export type ChargerPort = {
  id: string;
  active: boolean;
  power: number | null;
  voltage: number | null;
  current: number | null;
  device: string | null;
  protocol: string | null;
  cable: string | null;
};

export type ChargerSample = {
  t: number;
  w: number;
};

export type ChargerStatus = {
  connected: boolean;
  totalPower: number;
  maxPower: number;
  ports: ChargerPort[];
  device: {
    serialNumber: string | null;
    firmwareVersion: string | null;
    model: string | null;
  };
  cover: {
    name: string;
    iconHash: string | null;
    iconObjectKey: string | null;
    iconUrl: string | null;
  } | null;
  updatedAt: number | null;
};

export type ChargerPayload = ChargerStatus & {
  history: ChargerSample[];
  historyPartial: boolean;
  pushedAt: number;
  staleAfterMs: number;
} & ReporterPresence;

export type VibeCodingPlan = {
  tier: string;
  label: string;
};

export type VibeCodingLimit = {
  key: string;
  label: string | null;
  group: string | null;
  windowMinutes: number | null;
  usedPercent: number;
  // Unix 秒，不是毫秒；同文件其他时间戳多为毫秒
  resetsAt: number | null;
};

export type CodingUsageSource = "mac" | "agents" | "agents-otlp";

export type CodingUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
  activeDays: number;
  sessionCount: number | null;
};

export type CodingUsageDayTotals = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
};

export type CodingUsageSourceStatus = {
  source: CodingUsageSource;
  state: "ok" | "error" | "superseded" | "conflict";
  collectedAt: number | null;
  error: string | null;
  warning: string | null;
};

export type CodingUsageAgentView = {
  id: string;
  sources: CodingUsageSource[];
  models: string[];
  latestModel: string | null;
  lastDay: CodingUsageDayTotals | null;
  status: CodingUsageSourceStatus[];
};

export type CodingUsagePayload = {
  updatedAt: number | null;
  totals: CodingUsageTotals | null;
  topModels: Array<{ model: string; tokens: number }>;
  agents: CodingUsageAgentView[];
};

export type CodingNowPayload = {
  agents: Array<{
    id: string;
    activity: Array<{ source: CodingUsageSource; lastActivityAt: number; model: string | null }>;
  }>;
} & ReporterPresence;

export type CodingYearPayload = {
  origin: string;
  days: number[];
  models: string[];
  mix: number[][];
  updatedAt: number;
  todayAtSource: string;
};

export type GithubChartDay = {
  date: string;
  weekday: number;
  count: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

export type GithubChartPayload = {
  origin: string;
  counts: number[];
  scores: Array<0 | 1 | 2 | 3 | 4>;
  countsPartial?: boolean;
  from?: string;
};

export type GithubRepoContributor = {
  login: string;
  avatarUrl: string | null;
  commits: number;
  additions: number;
  deletions: number;
};

export type GithubRepoPayload = {
  repo: string;
  fetchedAt: number;
  totalsAt?: number;
  totals: {
    commits: number | null;
    additions: number | null;
    deletions: number | null;
    contributors: number;
  };
  contributors: GithubRepoContributor[];
};

export type StatusResponse<T> =
  | { ok: true; data: T; updatedAt?: number; servedAt?: number }
  | { ok: false; error: string };

export type IngestFailure = { ok: false; error: string };

export type IngestResponse<T = null> = { ok: true; data: T } | IngestFailure;

export type PowerBankPort = {
  id: string;
  active: boolean;
  direction: "in" | "out" | null;
  attached: boolean;
  power: number | null;
  voltage: number | null;
  current: number | null;
};

export type PowerBankStatus = {
  connected: boolean;
  battery: number | null;
  charging: boolean;
  timeToFullMinutes: number | null;
  thermalLimited: boolean;
  batteryHealth: number | null;
  inputPower: number;
  outputPower: number;
  temperatures: number[];
  ports: PowerBankPort[];
  device: {
    serialNumber: string | null;
    firmwareVersion: string | null;
    model: string | null;
  };
  updatedAt: number | null;
};

export type PowerBankPayload = PowerBankStatus & {
  pushedAt: number;
  staleAfterMs: number;
} & ReporterPresence;

export const PULSE_DOMAINS = ["coding", "tokens", "listening", "watching", "gaming", "charging", "activity"] as const;
export type PulseDomain = (typeof PULSE_DOMAINS)[number];

export type PulsePayload = {
  generatedAt: number;
  window: { from: number; to: number };
  lanes: PulseLanes;
};

export type ActivityRings = {
  moveKcal: number;
  moveGoalKcal: number;
  exerciseMinutes: number;
  exerciseGoalMinutes: number;
  standHours: number;
  standGoalHours: number;
};

export type ActivityStatus = ActivityRings & {
  date: string;
  secondsFromGMT: number;
  steps: number | null;
  distanceMeters: number | null;
  flightsClimbed: number | null;
};

export type ActivityPayload = ActivityStatus & {
  pushedAt: number;
  currentAtSource: boolean;
};

export type ServerTraffic = {
  cycleStart: number;
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  quotaBytes: number | null;
};

export type ServerStatus = {
  id: string;
  hostname: string;
  publicIp: string;
  country: string | null;
  city: string | null;
  isp: string | null;
  asn: number | null;
  asnOrg: string | null;
  os: string;
  kernel: string;
  cpuCores: number;
  cpuUsagePercent: number;
  load1: number;
  load5: number;
  load15: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  networkInterface: string;
  networkRxBytes: number;
  networkTxBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  traffic: ServerTraffic | null;
  uptimeSeconds: number;
  observedAt: number;
};

export type ServerPayload = ServerStatus & {
  pushedAt: number;
};

export type Workout = {
  id: string;
  activityType: string;
  startedAt: number;
  endedAt: number;
  secondsFromGMT: number;
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
  averageHeartRateBpm: number | null;
  maximumHeartRateBpm: number | null;
  elevationAscendedMeters: number | null;
  indoor: boolean | null;
};

export type WorkoutsPayload = {
  items: Workout[];
  pushedAt: number;
};

// 线上各列等长，时间为相对 window.from 的整秒；区间空缺是未知，不代表空闲。
export type PulseSpanColumns = { startSec: number[]; endSec: number[] };

export type PulseCodingLane = {
  kind: "coding";
  segments: PulseSpanColumns & { value: number[]; agentSources: number[] };
  assessments: PulseSpanColumns & { intensity: number[]; confidence: number[]; mode: (string | null)[] };
  summary: { humanSeconds: number; agentSeconds: number; bothSeconds: number };
};

export type PulseStateLane = {
  kind: "state";
  segments: PulseSpanColumns & { state: number[]; title: (string | null)[]; subtitle: (string | null)[] };
  // 只有 listening 有：从 Apple「最近播放的歌」与时长推出的别处播放；marginSec 是开播时刻的理想误差半宽
  uncertain?: PulseSpanColumns & { title: (string | null)[]; subtitle: (string | null)[]; marginSec: number[] };
  summary: { activeSeconds: number; titles: number };
};

export type PulsePowerLane = {
  kind: "power";
  segments: PulseSpanColumns & { watts: number[] };
  currentPowerW: number | null;
  summary: { peakW: number | null; energyWh: number };
};

export type PulseStepsLane = {
  kind: "steps";
  buckets: PulseSpanColumns & { steps: number[] };
  workouts: PulseSpanColumns & { activityType: string[] };
  summary: { steps: number };
};

export type PulseTokensLane = {
  kind: "tokens";
  buckets: PulseSpanColumns & { fresh: number[]; output: number[]; cacheRead: number[] };
  summary: {
    peakPerMinute: number | null;
    currentPerMinute: number | null;
    freshTokens: number;
  };
};

export type PulseLanes = {
  coding: PulseCodingLane;
  tokens: PulseTokensLane;
  listening: PulseStateLane;
  watching: PulseStateLane;
  gaming: PulseStateLane;
  charging: PulsePowerLane;
  activity: PulseStepsLane;
};
