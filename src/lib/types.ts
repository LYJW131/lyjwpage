/** 三个状态源统一的对外数据契约 —— 前端只认这里的类型。 */

export type WatchingItem = {
  id: string;
  /** 剧名（剧集）或片名（电影） */
  title: string;
  /** 「S01E05 · 集标题」之类的副标题，电影为空 */
  subtitle: string;
  /** 0–100 */
  progress: number;
  /** 竖版海报 */
  poster: string | null;
  /** 横版背景图，做卡片底图用 */
  backdrop: string | null;
  type: "Episode" | "Movie" | "Series" | "Other";
  year: number | null;
  /** 直接跳到 Emby 播放页 */
  link: string | null;
  /** 上次播放时间 ISO 字符串 */
  playedAt: string | null;
};

/**
 * 最近在听的一项。注意这是「资源」而不是单曲 ——
 * /v1/me/recent/played 返回的是专辑、歌单、电台这类容器。
 */
export type ListeningItem = {
  id: string;
  /** 专辑名 / 歌单名 / 电台名 */
  title: string;
  /** 专辑取 artistName，歌单取 curatorName */
  artist: string;
  artwork: string | null;
  link: string | null;
  /**
   * 封面取色，Apple 随 artwork 一起给：bgColor 加 textColor1..4，最多五个。
   *
   * 注意 textColor 是设计来叠在 bgColor 上的 —— 浅色封面配的是近黑，深色封面
   * 配的是浅色。所以不能直接拿来画东西，用之前必须把亮度拉齐，见前端那条彩虹条。
   */
  palette: string[];
  /**
   * 这张专辑 / 歌单所有曲目时长之和，毫秒。
   *
   * **只有列表第一项有**，其余一律 null：算它要顺着 href 再查一次曲目（歌单还
   * 要翻页），十项全算就是十次上游请求，而页面只在 hero 上显示这一个数。
   */
  durationMs: number | null;
};

/**
 * 推断出来的「正在听」。
 *
 * Apple 没有服务端可查的「当前播放」接口，这是靠观测最近播放列表的
 * 变化 + 该专辑/歌单的总时长推出来的，只是估计，不是实况。
 */
export type NowPlayingGuess = {
  /** 对应 items[0].id */
  itemId: string;
  /** 我们第一次观测到它排到最前的时刻（毫秒时间戳） */
  startedAt: number;
  /** 该专辑/歌单所有曲目时长之和 */
  durationMs: number;
};

export type ListeningPayload = {
  items: ListeningItem[];
  nowPlaying: NowPlayingGuess | null;
};

/**
 * 由本机遥测应用直接观测到的前台应用。只有应用本身的身份和图标，
 * 不含窗口标题、文件路径、提示词等任何窗口内容。
 */
export type DesktopActivity = {
  applicationName: string;
  bundleIdentifier: string | null;
  iconUrl: string | null;
  observedAt: number;
};

/** Music.app 的本机播放实况，与 Apple Music Web API 的“最近播放”完全独立。 */
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
  /**
   * 单曲循环。曲名、艺人、专辑在循环前后完全一样，光靠这些字段分不出
   * 「在循环」和「上游掉线了」，只能由来源明确告知。
   * 前端据此让进度回绕，而不是钉在 100%。
   */
  repeatOne: boolean;
  observedAt: number;
};

/**
 * MacBook 的前台应用。只有这一个来源。
 *
 * 和播放状态拆成两个接口：播放来源可能是 MacBook，也可能是 HomePod，
 * 两者的生命周期、上报路径、过期语义都不一样，绑在一起只会互相牵扯。
 */
export type DesktopPayload = {
  desktop: DesktopActivity | null;
  receivedAt: number | null;
  /** 上报器不可用或已超过心跳窗口。 */
  stale: boolean;
};

/** 实时播放。来源可能是 MacBook 的 Music.app，也可能是 HomePod。 */
export type MusicPayload = {
  music: LocalNowPlaying | null;
  receivedAt: number | null;
  /** 两个来源都没有可展示的播放 —— 是「没在放」，不是「数据过期」。 */
  idle: boolean;
  /** 与 /api/status/listening 的 items[].id 对应的 Apple Music 资源 ID。 */
  id: string | null;
  /**
   * 那首曲目在 Apple Music 上的地址，读取时现查的，不进设备上报的快照。
   * 目录里能精确匹配上就是直链，匹配不上退回搜索页。
   */
  link: string | null;
};

export type ChargerPort = {
  /** C1 / C2 / C3 */
  id: string;
  /** 该口是否正在输出（≠ 充电器整体是否在线） */
  active: boolean;
  /** 瓦，未输出时为 null */
  power: number | null;
  /** 伏，未输出时为 null */
  voltage: number | null;
  /** 安，未输出时为 null */
  current: number | null;
  /** 设备名，优先 model 再退 vendor，如 "MacBook Pro series" */
  device: string | null;
  /** 快充协议，如 "Apple PD Fast Charging" */
  protocol: string | null;
  /** 线缆能力等级，如 "EPR-240W MAX" */
  cable: string | null;
};

/** 总功率历史里的一个采样点 */
export type ChargerSample = {
  /** 毫秒时间戳 */
  t: number;
  /** 瓦 */
  w: number;
};

export type ChargerStatus = {
  /** BLE 会话是否活着 */
  connected: boolean;
  /** 整机输出功率（瓦） */
  totalPower: number;
  /** 额定最大功率，用来算功率条比例（Anker Prime 160W） */
  maxPower: number;
  ports: ChargerPort[];
  device: {
    serialNumber: string | null;
    firmwareVersion: string | null;
  };
  /** 遥测采集时刻，毫秒时间戳 */
  updatedAt: number | null;
};

/** 状态 + 服务端累积的历史，给前端画曲线用 */
export type ChargerPayload = ChargerStatus & {
  history: ChargerSample[];
  /**
   * history 里只有 `?since=` 之后新增的采样点，要接到客户端已有序列后面。
   * false 表示这是完整快照，直接替换 —— 首次请求，或客户端落后太多、
   * 中间那段已被服务端裁掉时都是这种。
   */
  historyPartial: boolean;
  /** 太久没收到新推送 */
  stale: boolean;
};

export type VibeCodingAgentId = "claude" | "codex";

export type VibeCodingDay = {
  /** ccusage 按本机时区生成的 YYYY-MM-DD */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** ccusage 按公开 API 价格估算，不是订阅账单 */
  apiEquivalentCostUSD: number;
};

/** 订阅套餐等级。tier 是上游原始枚举值，label 是给人看的展示名。 */
export type VibeCodingPlan = {
  /** 如 "prolite" / "max"，用来加 title 提示，页面主体不直接显示 */
  tier: string;
  /** 如 "Pro Lite" / "Max 5x" */
  label: string;
};

/**
 * 一个限额桶在一个时间窗口内的用量。
 *
 * 刻意做成数组而不是 `fiveHour` / `weekly` 这种固定字段：窗口的个数和时长是
 * 上游随时会调的（OpenAI 眼下就临时撤掉了 5 小时窗口，以后可能加回来），
 * 写死字段名的话每次变动都要改契约、改渲染、还得处理旧数据。
 */
export type VibeCodingLimit = {
  /** 桶 + 窗口的稳定标识，如 "codex.primary"，只用来当 React key */
  key: string;
  /** 子额度桶名如 "GPT-5.3-Codex-Spark"；主额度桶没有名字，为 null */
  label: string | null;
  /**
   * 粗分组，如 "session" / "weekly"。Claude 的限额接口只给分组不给时长，
   * Codex 反过来只给时长不给分组 —— 两者不会同时为 null，窗口名优先用时长算，
   * 没时长才回退到分组。不许由分组反推分钟数，官方没公开那个数。
   */
  group: string | null;
  /** 窗口时长，展示用的「5 小时 / 7 天」由它现算；上游没给就是 null */
  windowMinutes: number | null;
  /** 0–100 */
  usedPercent: number;
  /** Unix 秒（不是毫秒），上游没给就是 null */
  resetsAt: number | null;
};

export type VibeCodingAgent = {
  id: VibeCodingAgentId;
  label: string;
  models: string[];
  /** 最近活动 session 使用的模型，不是历史模型列表的排序结果 */
  currentModel: string | null;
  /** 整份历史里 token 占比最大的模型；旧版 Mac app 不上报，取不到就是 null */
  topModel: string | null;
  /** ccusage session 报告中最近一条活动；只公开时间，不公开会话或项目 */
  lastActivityAt: string | null;
  /** 最近 30 天，每 12 小时一个 session-token 聚合点 */
  activity: Array<{ t: number; tokens: number }>;
  today: VibeCodingDay;
  /** 旧版 Mac app 不会上报，取不到套餐时也是 null —— 不渲染，不占位 */
  plan: VibeCodingPlan | null;
  /** 没配 CLI 路径、凭据失效、旧版上报都会是空数组，UI 要能整块不渲染 */
  limits: VibeCodingLimit[];
  /**
   * 限额取失败的原因。空 limits 有两种含义 —— 这个 agent 没配（该整块不渲染），
   * 或者配了但取不到（该渲染并说明取不到）。靠它区分，null 表示前者。
   */
  limitsError: string | null;
  /**
   * 只在入库时用来校验这份报告完不完整（必须正好 7 天），页面不渲染它，
   * 所以发给浏览器的响应里会摘掉 —— 两个 agent 加起来 2.6KB，占三成。
   */
  last7Days?: VibeCodingDay[];
  last30DaysTokens: number;
};

export type VibeCodingTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Codex 的 reasoning 是 output 的子集，画堆叠条时要从普通 output 中扣掉 */
  reasoningTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  activeDays: number;
  sessions: number;
};

export type VibeCodingPayload = {
  agents: VibeCodingAgent[];
  totals: VibeCodingTotals;
  /** Claude Code 与 Codex 合并后的历史累计 token 前三名。 */
  topModels: Array<{ model: string; tokens: number }>;
  /** ccusage 扫描完成的时间，而不是浏览器取接口的时间 */
  collectedAt: string;
  source: "local" | "push";
  /**
   * 各 agent 的 activity 里只有 `?since=` 起的桶，要并回客户端已有序列。
   * 边界那个桶会重复出现并带上新值 —— 当前这 12 小时还在累加，是可变的。
   * false 表示完整快照，直接替换。
   */
  activityPartial: boolean;
  /** 推送超过 15 分钟没有更新 */
  stale: boolean;
};

/** 所有 /api/status/* 的统一信封 */
export type StatusResponse<T> =
  | { ok: true; data: T; fetchedAt: string }
  | { ok: false; error: string; fetchedAt: string };

/** 上报被拒。不带 data，且与 T 无关 —— 各 ingest 端点共用同一种失败形状 */
export type IngestFailure = { ok: false; error: string };

/**
 * 所有 /api/ingest/* 的统一信封。
 *
 * 和 StatusResponse 分开是因为语义不同：status 那边 ok:false 也返回 200
 * （降级态给页面看），ingest 这边失败就是失败，状态码得让上报器能据此决定
 * 重不重试。
 */
export type IngestResponse<T = null> = { ok: true; data: T } | IngestFailure;
