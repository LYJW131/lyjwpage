import type { CommitAuthor } from "@shared/commit-authors";

export * from "@shared/listening-types";
export * from "@shared/playstation-types";
export * from "@shared/pulse-types";

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

// 「此刻在不在线」由浏览器拿自己的钟算，源站只给这三个事实；首屏缓存会冻住服务端的结论。
export type ReporterPresence = {
  // 源站收到上报时的 epoch 毫秒，不是设备的 observedAt。
  lastSeenAt: number;
  // 上报器亲口声明的离线，只在优雅离开时为真，不等心跳窗口。
  declaredOffline: boolean;
  // 以载荷携带的值为准，浏览器不再读本地常量。
  heartbeatWindowMs: number;
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
  // 全历史去重后的可见模型数（名字按 codingModelName 归一，用量 > 0）；topModels 只是其中前几名。
  modelCount: number;
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
  // 默认分支最新的几次提交，新的在前；采集方取不到时沿用上一份，旧数据里可能缺席。
  recentCommits?: GithubRepoCommit[];
};

// sha 是 7 位短哈希；authors 是 GitHub 登录名（没有关联账号时用署名），含 Co-authored-by 里的协作者；committedAt 是 ISO 时间串。
// oid 是 40 位完整哈希，url 是提交页链接，verified 是 GitHub 认定的签名状态，authorDetails 是带头像与 coding agent 判定的作者明细；这四项在旧载荷里可能缺席。
export type GithubRepoCommit = {
  sha: string;
  title: string;
  authors: string[];
  committedAt: string | null;
  oid?: string;
  url?: string;
  verified?: boolean;
  authorDetails?: CommitAuthor[];
};

// updatedAt 只在可滞后层出现，是写入方最后一次成功取到数据的 epoch 毫秒，浏览器按各卡阈值据此判过时。
// servedAt 是源站交出信封的 epoch 毫秒，只为首帧：首屏缓存冻住后没有访客钟，按时间判过期的卡片拿它当钟。
// 信封不带逐次变化的时间戳，否则每次响应字节都不同，SWR 深比较失效、卡片每轮重渲染；客户端进 SWR 前必须剥掉 servedAt（lib/status-reads 的 withoutServedAt）。
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
  device: ChargingDeviceInfo;
  updatedAt: number | null;
};

export type ReportedPowerBankStatus = Omit<PowerBankStatus, "device"> & { device: ReportedChargingDeviceInfo };

export type PowerBankPayload = PowerBankStatus & {
  pushedAt: number;
  staleAfterMs: number;
} & ReporterPresence;

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
