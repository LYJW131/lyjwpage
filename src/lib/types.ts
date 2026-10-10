
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
  // bit/s。video / audio 描述选中的源媒体，转码时也不是转出来的规格。
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
  // 当前等级内的百分比进度，0–100。
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
  // epoch 毫秒；未解锁为 null。
  earnedAt: number | null;
  // 全球持有率，0–100。
  earnedRate: number | null;
};

export type TrophyTitle = {
  // 奖杯 API 的键，不是游玩列表的 titleId（PPSA…）；titleIds 是对齐到这张奖杯表的游戏 SKU，同一奖杯组可对应多个，不能互换或假定一对一。
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
  // 条目是专辑、歌单或电台这类容器，不是单曲；durationMs 是容器内曲目总时长，只为列表首项计算（算它要再查一次上游，页面也只显示首项）。
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

// 「此刻在不在线」由浏览器拿自己的钟算，源站只给这三个事实；首屏缓存会冻住服务端的结论。
export type ReporterPresence = {
  // 源站收到上报时的 epoch 毫秒，不是设备的 observedAt。
  lastSeenAt: number;
  // 上报器亲口声明的离线，只在优雅离开时为真，不等心跳窗口。
  declaredOffline: boolean;
  // 以载荷携带的值为准，浏览器不再读本地常量。
  heartbeatWindowMs: number;
};

export type ListeningPayload = {
  items: ListeningItem[];
  // 源站最近一次拉到这份列表的 epoch 毫秒，用来拒绝晚到的旧响应，不是过期判据：几分钟前的「最近在听」不算错，不该变灰。
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
  // 与 ListeningPayload.items[].id 对应的专辑 / 歌单资源 ID，不是单曲。
  id: string | null;
  link: string | null;
  // 目录里单曲本身的 ID，供「一起听」用 MusicKit 点播；匹配不到可播放的目录曲目时为 null。
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
  // 源站算出的暂停宽限剩余毫秒，到期应重取；null 表示没有这类定时失效。客户端不要拿设备的 observedAt 自行重算。
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
  // 当这首已放完再往下猜的一首，只给一层（then 里不再带 then）；猜不出时为 null。可能缺席（Worker 先后上线）。
  then?: NowListeningNext | null;
};

export type ChargerPort = {
  id: string;
  active: boolean;
  // 分别为 W / V / A；端口不输出时为 null。
  power: number | null;
  voltage: number | null;
  current: number | null;
  device: string | null;
  protocol: string | null;
  cable: string | null;
};

export type ChargerSample = {
  // epoch 毫秒；w 为瓦。
  t: number;
  w: number;
};

export type ChargingDeviceInfo = {
  firmwareVersion: string | null;
  model: string | null;
};

// serialNumber 只在上报与状态核心内部用（结构变化判据）；公开出口经 shared/charging-devices.ts 的投影剥掉。
export type ReportedChargingDeviceInfo = ChargingDeviceInfo & { serialNumber: string | null };

export type ChargerStatus = {
  connected: boolean;
  totalPower: number;
  maxPower: number;
  ports: ChargerPort[];
  device: ChargingDeviceInfo;
  cover: {
    name: string;
    iconHash: string | null;
    iconObjectKey: string | null;
    iconUrl: string | null;
  } | null;
  updatedAt: number | null;
};

export type ReportedChargerStatus = Omit<ChargerStatus, "device"> & { device: ReportedChargingDeviceInfo };

export type ChargerPayload = ChargerStatus & {
  history: ChargerSample[];
  // true：history 只是 ?since= 之后的增量，空数组也不得清空已有序列；false：完整快照，应替换。客户端首次请求或游标落后于服务端保留区间时得到完整快照。
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
  // reasoningTokens 已包含在 outputTokens 中；totalTokens 可含来源没分列的量，不应由各列相加覆盖。
  reasoningTokens: number;
  totalTokens: number;
  // 按公开 API 价格估算，不是订阅账单；costComplete 只表示有用量的日子是否都估全了价。
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
  // days[i] 是 origin 起第 i 天的合计；mix 稀疏，每行 [日偏移, models 下标, token 数, …]，空日不出现。
  days: number[];
  models: string[];
  mix: number[][];
  updatedAt: number;
  // 源站按站点时区算的今天（YYYY-MM-DD），热力图用它切掉窗尾的未来格；不能拿 updatedAt 代替，用量停一天会让今天那格跟着消失。
  todayAtSource: string;
};

export type GithubChartDay = {
  date: string;
  weekday: number;
  count: number;
  // 0 是无数据；1..HEATMAP_LEVELS 按非零天的分位分档。
  score: number;
  label: string;
};

export type GithubChartPayload = {
  origin: string;
  counts: number[];
  // true 时 counts 只覆盖 from 起的尾段；origin 仍是整窗原点。缺省或 false 是整窗。
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
  // 默认分支最新的几次提交，新的在前；采集方取不到时沿用上一份，旧数据里可能缺席。首页的提交列表另由构建期取，不读这里。
  recentCommits?: GithubRepoCommit[];
};

// authors 是 GitHub 登录名（没有关联账号时用署名），含 Co-authored-by 里的协作者；committedAt 是 ISO 时间串。
export type GithubRepoCommit = {
  sha: string;
  title: string;
  authors: string[];
  committedAt: string | null;
};

// updatedAt 只在可滞后层出现，是写入方最后一次成功取到数据的 epoch 毫秒，浏览器按各卡阈值据此判过时。
// servedAt 是源站交出信封的 epoch 毫秒，只为首帧：首屏缓存冻住后没有访客钟，按时间判过期的卡片拿它当钟。
// 信封不带逐次变化的时间戳，否则每次响应字节都不同，SWR 深比较失效、卡片每轮重渲染；客户端进 SWR 前必须剥掉 servedAt（lib/status-reads 的 withoutServedAt）。
export type StatusResponse<T> =
  | { ok: true; data: T; updatedAt?: number; servedAt?: number }
  | { ok: false; error: string; awaiting?: true };

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
  device: ChargingDeviceInfo;
  updatedAt: number | null;
};

export type ReportedPowerBankStatus = Omit<PowerBankStatus, "device"> & { device: ReportedChargingDeviceInfo };

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
  // 来源按其本地日历产生的 YYYY-MM-DD，secondsFromGMT 是随报的 UTC 偏移秒数；是否仍属当天由取数出口算成 currentAtSource，不能拿访客日期比较。
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
  // epoch 毫秒，周期按 UTC 账单日划分；rxBytes / txBytes 是跨重启累积的周期用量，不是 networkRxBytes / networkTxBytes（开机以来的网卡计数）的换算。
  cycleStart: number;
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  quotaBytes: number | null;
};

export type ServerStatus = {
  id: string;
  hostname: string;
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

// publicIp 是上报契约（server-parse 要求 IPv4），公开出口经 shared/server.ts#publicServer 剥掉。
export type ReportedServerStatus = ServerStatus & { publicIp: string };

export type ServerPayload = ServerStatus & {
  pushedAt: number;
};

export type Workout = {
  id: string;
  activityType: string;
  // startedAt / endedAt 为 epoch 毫秒；durationSeconds 是有效训练时长，可能小于起止之差，不能据两端重算覆盖。
  startedAt: number;
  endedAt: number;
  secondsFromGMT: number;
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
  elevationAscendedMeters: number | null;
  indoor: boolean | null;
};

export type WorkoutsPayload = {
  items: Workout[];
  pushedAt: number;
};

// iPhone 上报的训练另带心率摘要：只进历史归档，公开列表与状态接口不带（shared/workouts.ts#publicWorkout）。
export type ReportedWorkout = Workout & { averageHeartRateBpm: number | null; maximumHeartRateBpm: number | null };
export type ReportedWorkouts = { items: ReportedWorkout[]; pushedAt: number };

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
