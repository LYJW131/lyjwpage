/** 各状态源统一的对外数据契约 —— 前端只认这里的类型。 */

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
 * 正在播放的那一路视频的规格。上报器从 Emby 的会话和媒体流里挑出来，只带
 * 「Emby 说了什么」：编码名原样小写，语言是 Emby 给的代码，标签由浏览器现拼
 * （见 lib/watching-media）。Emby 那些本地化过的 DisplayTitle 不进来 —— 那是服务端
 * 语言的字符串，不是数据。
 *
 * 全部可空：Emby 有些流没有对应字段，转码时上游的读数也可能缺席。
 */
export type WatchingMedia = {
  /** 容器格式，如 mkv / mp4 */
  container: string | null;
  /** 整体码率，bit/s */
  bitrate: number | null;
  video: {
    /** 如 hevc / h264 / av1 */
    codec: string | null;
    width: number | null;
    height: number | null;
    /**
     * 动态范围。上报器按 Emby 的 ExtendedVideoType 归一，没有那个字段时退回
     * VideoRange 给的 hdr / sdr 两档。
     */
    range: "sdr" | "hdr" | "hdr10" | "hdr10plus" | "dolby-vision" | "hlg" | null;
    bitDepth: number | null;
  } | null;
  /** 正在输出的那条音轨 */
  audio: {
    /** 如 eac3 / dts / truehd */
    codec: string | null;
    /** 如 "DTS-HD MA"，只有部分编码带 */
    profile: string | null;
    channels: number | null;
    /** 如 "5.1" */
    layout: string | null;
    /** Emby 的语言代码，多为 ISO 639-2 三字母，也见 zh-CN 这类 */
    language: string | null;
  } | null;
  /** 选中的字幕；没开字幕就是 null */
  subtitle: {
    codec: string | null;
    language: string | null;
    /** 轨道自带的标题，如 "Simplified" */
    title: string | null;
    forced: boolean;
    external: boolean;
  } | null;
};

/** Emby 的播放方式。转码时 video / audio 里仍是源文件的规格，不是转出来的。 */
export type WatchingPlayMethod = "directplay" | "directstream" | "transcode";

/** PlayStation 最近游玩列表中的一项；图片仍是 PSN 公共 CDN 的原始地址。 */
export type PlaystationGame = {
  titleId: string;
  name: string;
  /** PSN 上游枚举；未知或上游缺席时为 null，不在入库层猜测。 */
  category: string | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  playDurationMs: number | null;
  imageUrl: string | null;
  /**
   * 这份 entitlement 怎么来的。上游原样保留，已见 `ps_plus` /
   * `none(purchased)` / `other`。缺席为 null，不在入库层猜测。
   * `ps_plus` 表示当前这份是 Plus 会员库权益，不是「这款曾经上过 Plus 目录」。
   */
  service: string | null;
  /** 购买库标成预购。没对上购买库就是 false。 */
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

/** 内部 `StateCore.playstationPower()` RPC 所读取的存储形状。 */
export type PlaystationPowerPayload = {
  on: boolean;
  observedAt: number;
  entityId: string | null;
};

export type PlaystationPresencePayload = {
  observedAt: number;
  online: boolean;
  /**
   * PSN 上游枚举。已见 `availableToPlay` / `doNotDisturb` / `unavailable`，
   * 头像那颗点按这三档画绿 / 黄 / 灰。缺席不在入库层猜。
   */
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
  /** PSN 资料头像。不用 personalDetail 里的实名照片。 */
  avatarUrl: string | null;
  plus: boolean;
  level: number;
  tier: number;
  trophyPoint: number;
  levelBasePoint: number;
  levelNextPoint: number;
  /** 当前等级内进度，0–100 */
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
  /** 解锁时刻，epoch 毫秒；未解锁为 null */
  earnedAt: number | null;
  /** 全球持有率，0–100 */
  earnedRate: number | null;
};

/**
 * 一个奖杯标题（一款游戏或一个奖杯组）。
 *
 * `npCommunicationId` 是奖杯 API 的键，和游玩列表里的 `titleId`（PPSA…）
 * 不是同一个东西，所以不叫 titleId。两边靠 Worker 走官方
 * `getUserTrophiesForSpecificTitle` 对齐；同一奖杯组可能对应多个 SKU。
 */
export type TrophyTitle = {
  npCommunicationId: string;
  name: string;
  localizedName: string | null;
  titleIds: string[];
  /** 方形奖杯组图标，和 PS App 奖杯列表同一张 */
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
  /** 对齐后的 entitlement；任一 SKU 来自 Plus 库则为 `ps_plus`。 */
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
  /**
   * 这三个一起就是明细里那一行的坐标（拼法见 trophyRowKey）。带着它，
   * 点「最近解锁」能直接定位到那一行，不必拿奖杯名去猜 —— 同一款游戏里
   * 重名的奖杯本来就有（各奖杯组一份）。
   */
  id: number;
  groupId: string;
  titleName: string;
  trophyName: string;
  type: TrophyType;
  iconUrl: string | null;
  earnedAt: number;
};

/**
 * 首页提要用的一款游戏：进度和四色杯子，不含逐个奖杯。
 */
export type TrophyTitleDigest = {
  npCommunicationId: string;
  name: string;
  localizedName: string | null;
  titleIds: string[];
  progress: number;
  defined: TrophyCounts;
  earned: TrophyCounts;
};

/**
 * 首页提要：等级、合计、最近解锁、各标题进度。不含逐个奖杯，
 * 避免把整份目录塞进首屏 HTML。
 */
export type TrophiesSummaryPayload = {
  observedAt: number;
  profile: TrophyProfile;
  /**
   * 已解锁的四色合计，从 `titles` 逐金属加总 —— **别读 `profile.earned`**。
   * 那个是账号级的数，而 titles 被上报 Worker 的屏蔽名单滤过：两边不同源，
   * 屏蔽名单一非空数字就偏高。profile 里的等级、点数照旧读 profile，
   * 那些本来就是账号级的事实。
   */
  earned: TrophyCounts;
  recent: TrophyUnlock[];
  titles: TrophyTitleDigest[];
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
 * 最近播放的一首歌，来自 /v1/me/recent/played/tracks。只用作 Pulse 听歌痕迹的证据，
 * 不上卡片。Apple 按播放时间倒序给，不给播放时刻。
 */
export type RecentTrack = {
  /** 目录曲目 id，资料库里的歌是 `i.` 开头的资料库 id */
  id: string;
  title: string;
  artist: string;
  album: string | null;
};

/**
 * Mac 上报器的存活。源站只盖这三个事实，「此刻在不在线」由浏览器拿自己的钟算
 * （hooks/use-stale 的 useReporterStale），源站不在读取时下结论：结论会跟着首屏缓存
 * 冻住，看到时多半已经不对了。
 *
 * 首帧的钟是首屏信封的 `servedAt`（见 StatusResponse），判出的是源站交出这份数据时
 * 的结论；只有连 servedAt 也没有时才不判过期。亲口离线不是时间函数，首帧就作数。
 *
 * lastSeenAt 是 ingest 收到时的源站钟，不是设备 observedAt。
 * 心跳窗口跟 payload 走，别在浏览器再读一份常量 —— 和充电头的 staleAfterMs 一样。
 */
export type ReporterPresence = {
  lastSeenAt: number;
  /** 上报器亲口声明的离线，只在优雅离开（退出 / 睡眠）时为真 */
  declaredOffline: boolean;
  /**
   * 超过这么久没心跳就算掉线。源站按 `heartbeatWindowMs()` 现算
   * （默认值 `HEARTBEAT_WINDOW_MS`，见 lib/freshness）。
   */
  heartbeatWindowMs: number;
};

export type ListeningPayload = {
  items: ListeningItem[];
  /**
   * 源站上一次从 Apple 拉到这份列表的时刻。
   *
   * **不是新鲜度指标，是代数**：这份数据由采集 Worker 的 `appleRecentJob` 定时刷，
   * 一份几分钟前的「最近在听」本身没有错，不该照搬别的卡那套变灰处理。它的用处是
   * 挡住晚到的旧数据，见 lib/status-reads。
   */
  fetchedAt: number;
};

/**
 * 遥测应用主动隐藏前台应用时上报的占位 bundle id。
 *
 * 由 Mac 端产生、Worker 入库时据此强制清掉窗口标题、站点据此画「Hidden」。
 * 几处都要认同一个字面量，所以它和 `DesktopActivity` 放在一起 —— 这个文件
 * 没有任何 import，Worker 和浏览器包都能拿，不会把存储层拖进客户端。
 */
export const HIDDEN_DESKTOP_BUNDLE_ID =
  "com.liangyangjunwei.MacTelemetryHub.hidden";

/**
 * 由本机遥测应用直接观测到的前台应用：应用本身的身份、图标，以及当前窗口标题。
 *
 * `windowTitle` 是唯一一项窗口内容，仍不含文件路径、提示词等其它窗口内部信息。
 * 没有标题（应用没给、被裁成空、或前台应用被隐藏）一律是 `null`，不是缺字段 ——
 * 消费方只需判空，不必再分「没上报」和「没有标题」。
 */
export type DesktopActivity = {
  applicationName: string;
  bundleIdentifier: string | null;
  windowTitle: string | null;
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
export type DesktopPayload = ReporterPresence & {
  desktop: DesktopActivity | null;
  receivedAt: number | null;
};

/** Mac 当前系统时区。只在 timezone 模块启用时展示，不看上报器在不在线。 */
export type TimezoneActivity = {
  /** IANA 时区标识，如 Asia/Singapore */
  identifier: string;
  abbreviation: string | null;
  /** 当前 UTC 偏移，秒 */
  secondsFromGMT: number;
  observedAt: number;
};

export type TimezonePayload = {
  timezone: TimezoneActivity | null;
  /** 缓存填充时刻。时间卡首帧用它画钟，页面里不能 Date.now()。 */
  snapshotAt: number;
};

/**
 * 选中的那首之外还在放的另一个来源。字段和 NowListeningPayload 里同名的几项一一对应。
 */
export type NowListeningAlternate = {
  music: LocalNowPlaying;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
};

/**
 * 实时播放。来源可能是 MacBook 的 Music.app，也可能是 HomePod。
 *
 * 带着 Mac 上报器的存活（`ReporterPresence`，和 HomePod 无关）：选中的是 Mac 那首
 * （`music.source === "apple-music"`）时，浏览器拿自己的钟判 Mac 掉没掉线，掉了就
 * 不再举着它，换成 `alternate`。源站选的那一次只在取数那一刻成立，首屏 HTML 冻住
 * 之后 Mac 悄悄断了，没有任何推送会来纠正它。
 */
export type NowListeningPayload = ReporterPresence & {
  music: LocalNowPlaying | null;
  receivedAt: number | null;
  /** 两个来源都没有可展示的播放 —— 是「没在放」，不是「数据过期」。 */
  idle: boolean;
  /** 与 /api/status/listening 的 items[].id 对应的 Apple Music 资源 ID。 */
  id: string | null;
  /**
   * 那首曲目在 Apple Music 上的地址，由目录查询得到（`resolveTrackLookup`，按曲目缓存），
   * 不进设备上报的快照。目录里能精确匹配上就是直链，匹配不上退回搜索页。
   */
  link: string | null;
  /**
   * 目录里那首**曲子本身**的资源 ID —— 上面那个 `id` 是它所属的专辑 / 歌单，
   * 两个键挨在一起，别拿错。
   *
   * 「一起听」拿它点播：访客用自己的订阅授权之后，MusicKit 按这个 ID 播同一首。
   * 搜不到（本地导入、非目录内容）时是 null，那时按钮不出现 —— 没有可播的东西。
   */
  songId: string | null;
  /**
   * 主人队列里当前曲后面那两首的目录 ID，已经在服务端搜过。
   *
   * 「一起听」拿它们 playNext，换歌时就能 skipToNext 而不是整队重排。
   * 搜不到或 HomePod 没有队列时是空数组。
   */
  upcomingSongIds: string[];
  /**
   * 目录说这首有没有歌词。true 时浏览器才去 `/api/lyrics` 取同步歌词跟着
   * 进度条走；false 一律不发请求。搜不到曲子（songId 为 null）时是 false。
   */
  hasLyrics: boolean;
  /**
   * 这份选择还能成立多久（毫秒）。null = 不会因为单纯的时间流逝而改变。
   *
   * 只有暂停宽限期会给出非 null 值。客户端据此把下一次取数排在到期那一刻，
   * 不要自己拿 music.observedAt 去算 —— 那是设备的时钟，见 pickNowListening。
   */
  expiresInMs: number | null;
  /**
   * 选中的是 Mac、而 HomePod 同时也在放时，HomePod 那首（已查好目录）；其余情况 null。
   *
   * Mac 悄悄死掉时不会有推送（HomePod 那侧只在状态变化时推），浏览器按自己的钟
   * 判出 Mac 掉线的那一刻，手上得已经有接班的那首，否则要干等下一轮轮询。
   * 只收在放的：暂停宽限期要拿源站的钟减设备的 observedAt，浏览器不算。
   */
  alternate: NowListeningAlternate | null;
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
    /** 上报器给的型号，如 "A2687"。顶栏拿它拼 Anker 前缀。 */
    model: string | null;
  };
  /**
   * 充电头当前封面。上报器把 Anker 源 JPEG 原样直传到 R2 后带 iconObjectKey。
   * iconUrl 是读取时由 iconObjectKey 拼成的同源路径 `/img/<objectKey>`（publicAssetPath），不入库。
   */
  cover: {
    name: string;
    iconHash: string | null;
    iconObjectKey: string | null;
    iconUrl: string | null;
  } | null;
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
  /** 源站最近一次收到充电头模块或给它续上的心跳 */
  pushedAt: number;
  /** 这份数据自己的过期窗口，由服务端的 chargerStaleAfterMs() 定（不短于心跳窗口，可按上报间隔加长） */
  staleAfterMs: number;
} & ReporterPresence;

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
 * 上游随时会调的（厂商会撤掉或加回某个窗口），写死字段名的话每次变动都要改契约、
 * 改渲染。
 */
export type VibeCodingLimit = {
  /** 桶 + 窗口的稳定标识，如 "codex.primary"，只用来当 React key */
  key: string;
  /** 子额度桶名如 "GPT-5.3-Codex-Spark"；主额度桶没有名字，为 null */
  label: string | null;
  /**
   * 粗分组，如 "session" / "weekly"。上游没给时为 null；展示层不得
   * 由分组反推窗口时长。
   */
  group: string | null;
  /** 窗口时长，展示用的「5 小时 / 7 天」由它现算；上游没给就是 null */
  windowMinutes: number | null;
  /** 0–100 */
  usedPercent: number;
  /** Unix 秒（不是毫秒），上游没给就是 null */
  resetsAt: number | null;
};

/**
 * coding agent token 用量的观测来源，名字 = 上报入口的来源名。
 *
 * 登记表（各来源看得到什么、谁覆盖谁）在 shared/coding-usage-sources，那边 `satisfies` 这个
 * 联合类型；放在这里是因为公开 payload 要用它，而这个文件不 import 任何东西。
 */
export type CodingUsageSource = "mac" | "agents" | "agents-otlp";

/** 全部 agent、全部历史的合计。按来源登记的规则去重后相加（shared/coding-usage-sources） */
export type CodingUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** outputTokens 的子集 */
  reasoningTokens: number;
  /** ≥ 四列之和，多出的是来源没分列的量 */
  totalTokens: number;
  /** 按公开 API 价格估算，不是订阅账单 */
  apiEquivalentCostUSD: number;
  /** 每个有 token 的日子都估全了价；来源采集失败只体现在各行的 status，不拉低这里 */
  costComplete: boolean;
  /** 全部历史、全部 agent 里有用量的站点日个数 */
  activeDays: number;
  /** 各来源会话数（非 null 的）相加；没有一个来源数得出会话时为 null */
  sessionCount: number | null;
};

/** 一个 agent 在某个站点日的用量：参与合计的各来源在这一天的行相加 */
export type CodingUsageDayTotals = {
  /** Asia/Shanghai 站点日，YYYY-MM-DD */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
};

/**
 * 一个来源对这个 agent 的状态。`superseded`：有账号级来源覆盖它，它的行不参与合计；
 * `conflict`：同一 agent 有两个账号级来源（配置错误），登记在后的这个不参与合计。
 */
export type CodingUsageSourceStatus = {
  source: CodingUsageSource;
  state: "ok" | "error" | "superseded" | "conflict";
  /** 这个来源最近一次成功采集的时刻（epoch 毫秒）；从没成功过为 null */
  collectedAt: number | null;
  error: string | null;
  warning: string | null;
};

export type CodingUsageAgentView = {
  id: string;
  /** 参与合计的来源 */
  sources: CodingUsageSource[];
  /** 全部历史按 token 降序，最多 `CODING_AGENT_MODELS`（shared/coding-usage-view）个 */
  models: string[];
  /** 最近一个有模型用量的日子里 token 最多的模型；闲置时拿它当模型名 */
  latestModel: string | null;
  /** 最近一个有行的站点日。是不是今天由浏览器按自己的站点日判 */
  lastDay: CodingUsageDayTotals | null;
  status: CodingUsageSourceStatus[];
};

/**
 * `/api/status/coding`：多来源合并后的用量视图。状态核心在用量事实变了时算好存一份，
 * 读出口原样给；和钟有关的结论（lastDay 是不是今天）留给浏览器。不推送，卡片自己轮询。
 *
 * 展示名、图标、行的排布不在这里，见站点的 agent 登记表。
 */
export type CodingUsagePayload = {
  /** 视图最后一次重算的时刻 = 最近一封改变了日行的用量事实的收到时刻；还没有任何事实时为 null */
  updatedAt: number | null;
  totals: CodingUsageTotals | null;
  /** 全部历史的前三模型（隐藏名单之外） */
  topModels: Array<{ model: string; tokens: number }>;
  agents: CodingUsageAgentView[];
};

/**
 * `/api/status/coding/now`（推送事件 `coding-now` 带整份）：各 agent 各来源最近一条用量事件。
 *
 * 灯由浏览器按时刻现算：任一有效来源的时刻在 `CODING_ACTIVE_WINDOW_MS`
 * （lib/coding-agents）内就亮。带着 Mac 的存活：Mac 亲口离线时，只来自 `mac` 的时刻
 * 立即作废（优雅离开立刻灭灯），别的来源不受影响。
 */
export type CodingNowPayload = {
  agents: Array<{
    id: string;
    /** 各来源最近一条事件，时刻降序；浏览器取第一个有效的 */
    activity: Array<{ source: CodingUsageSource; lastActivityAt: number; model: string | null }>;
  }>;
} & ReporterPresence;

/**
 * `/api/status/coding/year`：过去 53 周的日合计 token，外加每天前几名模型的拆分。任一来源有日行就出图。
 * 档位和文案浏览器现算，不进信封；编码见 lib/coding-year 的 encodeCodingYear。
 */
export type CodingYearPayload = {
  /** 53 周窗口的第一个周日，YYYY-MM-DD */
  origin: string;
  /** `days[i]` 是 origin 起第 i 天的合计 */
  days: number[];
  /** 出现在每天拆分里的模型名，`mix` 里的下标指这里 */
  models: string[];
  /** 稀疏的每天拆分，一行 `[offset, idx, tokens, idx, tokens, …]`，offset 是 origin 起第几天；空日子不出现 */
  mix: number[][];
  /** 年度视图最后一次重算的时刻 */
  updatedAt: number;
  /**
   * 源站在取数出口按自己的钟算的「今天是哪一天」（站点时区，YYYY-MM-DD），热力图拿它切掉窗尾那截
   * 未来格子。整个由源站算：首帧时浏览器手上没有一个会走的钟；也不能拿 `updatedAt` 顶替 —— 用量
   * 停一天，今天那格就跟着少一格，和隔壁 GitHub 那张图错开一列。
   */
  todayAtSource: string;
};

/** 贡献热力图的一天。label 跟资料页 hover 同一句，浏览器现算，不进信封 */
export type GithubChartDay = {
  date: string;
  weekday: number;
  count: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

/**
 * 过去约 53 周的日贡献。形状对齐年度 token：原点 + 日序列，date / weekday /
 * label 浏览器现算。`scores` 是 GitHub 自己的四分位，不能在这边重算。
 */
export type GithubChartPayload = {
  origin: string;
  counts: number[];
  scores: Array<0 | 1 | 2 | 3 | 4>;
  /**
   * counts / scores 只覆盖 `from` 起的窗尾。缺省或 false 是整份窗口。
   */
  countsPartial?: boolean;
  /** countsPartial 时这段尾巴的第一天 */
  from?: string;
};

/**
 * 本仓库（site.repo）里一位贡献者，形状贴着 GitHub `/stats/contributors` 的返回。
 *
 * 口径和 GitHub 仓库 Insights → Contributors 那一页完全一致：**这是「贡献」而不是
 * 「提交归属」**，带 `Co-authored-by` 的提交会整条同时记在作者和每位协作者名下，
 * 增删行也各记一遍。所以这几个数字之间会重叠，加起来不等于全仓总数。
 */
export type GithubRepoContributor = {
  login: string;
  avatarUrl: string | null;
  commits: number;
  additions: number;
  deletions: number;
};

export type GithubRepoPayload = {
  /** "owner/name"，如 "LYJW131/lyjwpage" */
  repo: string;
  /** 贡献者名单取到的时刻，epoch 毫秒 */
  fetchedAt: number;
  /**
   * 顶部三个总数取到的时刻。名单和总数是两个接口、各自沿用上一份（见采集 Worker 的
   * `githubRepoJob`），卡片按它判总数过没过期；没写时就是 fetchedAt
   */
  totalsAt?: number;
  /**
   * 全仓总数，另走 GraphQL 算，不是把 contributors 加起来（那样会重复计数）。
   * 取不到就是 null，卡片显示「—」。
   */
  totals: {
    /** 默认分支的提交数 */
    commits: number | null;
    additions: number | null;
    deletions: number | null;
    contributors: number;
  };
  /** 按 commits 倒序 */
  contributors: GithubRepoContributor[];
};

/**
 * 所有 /api/status/* 的统一信封。
 *
 * 信封不带逐次变化的时间戳：每个响应都盖一个 fetchedAt 的话，**任何两次响应在字节
 * 层面都不同** —— 而 SWR 靠深比较决定要不要更新缓存，于是数据一个字节没变，
 * 每轮轮询也会让所有卡片重渲染一遍（充电头曲线、最近在听那个带布局动画的列表，
 * 全都白跑）。真要知道服务端什么时候算的，看响应头 X-Fetched-At。
 *
 * 信封里的时间字段各有分工：
 *
 * - `updatedAt` 只出现在可滞后层（见 lib/status-views 的 layer），是写入方最后一次
 *   成功取到这份数据的时刻，随写入方的节奏变，不随每次请求变。浏览器拿它按各卡的
 *   阈值判断这份是不是已经过时，以及首屏那份要不要挂载后补取。
 * - `servedAt` 是源站交出这份信封的时刻（epoch 毫秒，statusEnvelope 盖），只为首帧：
 *   首屏按卡缓存时它跟着冻住，首帧没有访客钟，按时间判过期的卡片拿它当钟 ——
 *   服务端预渲染和 hydrate 读的是同一个值，判出来的就是填缓存那一刻源站会下的结论。
 *   浏览器轮询取回的信封在进 SWR 之前摘掉它（lib/status-reads 的 withoutServedAt），
 *   上面那个重渲染的坑不会回来。
 */
export type StatusResponse<T> =
  | { ok: true; data: T; updatedAt?: number; servedAt?: number }
  | { ok: false; error: string };

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

/**
 * 充电宝的一个端口。
 *
 * 和充电头的 `ChargerPort` 形状接近但不一样：C1/C2 是**双向**的，所以多一个
 * `direction`；固件不上报插在上面的设备是什么（充电头会），所以没有 `device`。
 */
export type PowerBankPort = {
  /** C1 / C2 / A / B（B 是底座进电口） */
  id: string;
  /** 该口是否有功率在流。空闲口的读数是过期的，一律置 null */
  active: boolean;
  /** "in" 取电 / "out" 供电 / null 空闲 */
  direction: "in" | "out" | null;
  /** 线插着，不管有没有协商上供电 */
  attached: boolean;
  power: number | null;
  voltage: number | null;
  current: number | null;
};

export type PowerBankStatus = {
  connected: boolean;
  /** 电量百分比，固件给到两位小数 */
  battery: number | null;
  /** 正在进电。放电和待机都是 false */
  charging: boolean;
  /** 充满还需多少分钟。只在充电时有意义，其余为 null */
  timeToFullMinutes: number | null;
  /** 机身过热、拒绝充电。插着线也不进电，所以要单独暴露 */
  thermalLimited: boolean;
  /**
   * 电池健康度，整数百分比（剩余容量 / 出厂容量）。
   *
   * 上报器只在每次连上充电宝时收到一次，之后整个会话都不会再变，所以它不参与
   * 「有没有变化」的判断，断开期间也保留上一次的值。
   */
  batteryHealth: number | null;
  inputPower: number;
  outputPower: number;
  /** 两个温度传感器，摄氏度 */
  temperatures: number[];
  ports: PowerBankPort[];
  device: {
    serialNumber: string | null;
    firmwareVersion: string | null;
    /** 上报器给的型号，如 "A110G"。顶栏拿它拼 Anker 前缀。 */
    model: string | null;
  };
  updatedAt: number | null;
};

/**
 * 充电宝不存历史。
 *
 * 卡片上没有曲线 —— 电量的变化尺度以小时计，一条几乎水平的线不如把空间让给
 * 电量条和收放电数字。既然没人消费，采样、裁剪、增量游标那一整套就都不该存在。
 */
export type PowerBankPayload = PowerBankStatus & {
  /** 源站最近一次收到充电宝模块的时刻 */
  pushedAt: number;
  /** 这份数据自己的过期窗口，由服务端的 powerBankStaleAfterMs() 定（不短于心跳窗口，可按上报间隔加长） */
  staleAfterMs: number;
} & ReporterPresence;

/**
 * 跨域活动脉搏（pulse）：最近一个窗口（PULSE_WINDOW_MS）「在做什么」的事实时间线，首页 Pulse 卡片的底。
 * 存储形状在 shared/pulse-timeline，对外那份在下面的 PulsePayload。
 *
 * 不叫 activity：那个名字在本仓库已经是 Apple Watch 圆环
 * （`/api/status/activity`、`activity:today`、`ActivityStatus`）。
 */
export const PULSE_DOMAINS = ["coding", "tokens", "listening", "watching", "gaming", "charging", "activity"] as const;
export type PulseDomain = (typeof PULSE_DOMAINS)[number];

/**
 * 公开端点 `/api/status/pulse` 的形状。
 *
 * 只给原始事实：状态、标题、瓦数、步数。档位、颜色、摘要文案都在卡片里现算，
 * 以后换展示方式不用迁移数据。媒体与游戏标题可以公开；应用名、模型名不出这个端点
 * （Coding 只给三色带和 Jev 的强度 / 模式）。token 只以各来源、各 agent、各模型相加后的
 * 五分钟桶出现（Tokens 道），不带模型名和来源。
 */
export type PulsePayload = {
  generatedAt: number;
  window: { from: number; to: number };
  lanes: PulseLanes;
};

/**
 * Apple Watch 的活动圆环：活动 / 锻炼 / 站立，一环两个数 —— 已完成和目标。
 *
 * **目标值跟着上报走，不在站点这侧写死。** 它只有原生 App 读得到
 * （`HKActivitySummary`），而且是人随时会调的；写死在站点里的话，改一次目标
 * 就要发一次版，还得两份部署一起改。
 *
 * 单位进字段名（AGENTS.md「API 命名与跨端契约」的跨来源字段一行）：三环在 Apple
 * 那边分别按千卡、分钟、小时计，三种单位摆在一起时，光看 `move` / `moveGoal` 认不出
 * 该配哪个。
 */
export type ActivityRings = {
  /** 活动：当天已消耗的活动能量，千卡 */
  moveKcal: number;
  moveGoalKcal: number;
  /** 锻炼：当天累计的锻炼分钟数 */
  exerciseMinutes: number;
  exerciseGoalMinutes: number;
  /** 站立：当天有站起来动过的小时数 */
  standHours: number;
  standGoalHours: number;
};

/**
 * 一天的健身记录。和 `DesktopActivity` 没有关系 —— 那个是 Mac 的前台应用，
 * 这里的「活动」是 Apple 的健身记录（Activity / 活动圆环）。
 *
 * `date` 是**手表本地的那一天**，站点绝不自己算：圆环在手表所在时区的午夜归零，
 * 而源站和访客的钟都不在手表所在的时区，两边都答不出「手表那边今天是几号」。
 * `secondsFromGMT` 和 Mac 时区模块同名同单位（AGENTS.md「API 命名与跨端契约」的
 * 跨来源字段一行），据此现算「手表那边现在是不是还是这一天」—— 跨过午夜之后，这份
 * 满环说的就是昨天了。
 */
export type ActivityStatus = ActivityRings & {
  /** 手表本地日，YYYY-MM-DD */
  date: string;
  /** 观测时手表所在时区的 UTC 偏移，秒 */
  secondsFromGMT: number;
  /** 当天步数。上报器没开这项权限时为 null，卡片整格不渲染 */
  steps: number | null;
  /** 当天步行 + 跑步距离，米 */
  distanceMeters: number | null;
  /** 当天爬楼层数 */
  flightsClimbed: number | null;
};

/**
 * 活动圆环对外那一份。
 *
 * **没有 `ReporterPresence`。** 这不是 Mac 上报器那种「一直在线才算数」的数据源：
 * 手机整夜不动就没有新样本可推，那时圆环冻在最后一次推送上是正确的，不是掉线。
 * 光靠时间流逝会让这份数据变错的是手表那边跨过了午夜：圆环已经归零而站点还举着
 * 昨天那份，所以源站盖 `currentAtSource`。另外它在可滞后层，信封带 `updatedAt`，
 * 超过一夜还没刷新（ACTIVITY_STALE_MS）卡片就写 Unavailable。
 */
export type ActivityPayload = ActivityStatus & {
  /** 源站收到这份的时刻。卡片拿它写「几分钟前」，不用来判过期 */
  pushedAt: number;
  /**
   * 源站在取数出口按自己的钟算的那一次「手表那边现在还是不是 `date` 这一天」。
   *
   * **这件事整个由源站算，浏览器不自己算一遍。** 和实时卡的在线判断不一样
   * （那些只盖时间戳、由浏览器按自己的钟算）：浏览器手上没有一个会走的钟
   * （`useMountedAt` 是挂载那一刻的定格），拿它比日期的话，开着不动的标签页永远
   * 停在挂载那一天，跨夜之后新到的**今天**那份反而会被判成「昨天的记录」。
   *
   * 它是数据字段，服务端预渲染和 hydrate 读到的是同一个值，不会水合不一致。
   * 端点每次请求现算，卡片按 `STATUS_VIEWS.activity.cadenceMs` 排期取数（首屏逾期才在
   * 挂载后补取，见 hooks/use-status），取回来的那份就带着最新的它；冻住的首屏那份
   * 跟着首屏缓存（`cacheLife` 见 lib/first-screen）。
   */
  currentAtSource: boolean;
};

/**
 * 落地节点此刻的读数。单位进字段名（AGENTS.md「API 命名与跨端契约」的跨来源字段
 * 一行）：字节、秒、百分比三种摆在一起，光看 `memory` / `uptime` 认不出该配哪个。
 *
 * `id` 是 SSH 配置里的那一个（`misaka-jp`），`hostname` 是机器自己报的
 * `uname`。两份都留：卡片上认的是人起的名字，出了问题对照机器要用另一份。
 */
/**
 * 计费周期内攒下来的流量。
 *
 * `/proc/net/dev` 那两个计数器一重启就归零，所以这份不是站点算的，也不是那两个
 * 累计字节的换算：上报器把每轮的增量累加进当前周期、落在自己的状态文件里，跨
 * 重启接着数。站点只负责显示。
 */
export type ServerTraffic = {
  /** 当前计费周期的起点，epoch 毫秒。按 UTC 的自然月，起始日跟着套餐账单日 */
  cycleStart: number;
  /** 周期止点（= 下一周期的起点），epoch 毫秒 */
  cycleEnd: number;
  rxBytes: number;
  txBytes: number;
  /** 套餐配额。没配为 null，卡片那时只报用量、不画进度 */
  quotaBytes: number | null;
};

export type ServerStatus = {
  id: string;
  hostname: string;
  /** 默认路由网卡上的公网地址。卡片上的那串 IP */
  publicIp: string;
  /** 查 IP 得到的国家，如「日本」。查不到为 null */
  country: string | null;
  /** 查 IP 得到的城市，如 Tokyo */
  city: string | null;
  isp: string | null;
  /** 自治系统号，没有 AS 前缀。查不到为 null */
  asn: number | null;
  asnOrg: string | null;
  os: string;
  kernel: string;
  cpuCores: number;
  /** 0–100，这一段采样窗口内的平均占用 */
  cpuUsagePercent: number;
  load1: number;
  load5: number;
  load15: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  diskTotalBytes: number;
  diskUsedBytes: number;
  /** 默认路由那块网卡。和累计字节挨着，免得多网卡时分不清这份是谁的 */
  networkInterface: string;
  networkRxBytes: number;
  networkTxBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  /**
   * 计费周期内的累计流量。上报器没攒（状态文件写不进、或这台没开）时为 null。
   *
   * 和上面那两个累计字节不是一回事：那两个是开机以来的网卡计数器，这份跨重启。
   */
  traffic: ServerTraffic | null;
  uptimeSeconds: number;
  /** 采集时刻，epoch 毫秒 */
  observedAt: number;
};

/**
 * 落地节点对外那一份，存在可滞后层（KV `server:v1`）。
 *
 * **没有 `ReporterPresence`。** 那套是 Mac 上报器的存活：亲口离线、心跳窗口、
 * 全站四张卡共用一个答案。这台节点的上报器挂了只影响这一张卡：信封里的
 * `updatedAt` 超过 `SERVER_STALE_MS` 就是 Unavailable，由浏览器判断。
 */
export type ServerPayload = ServerStatus & {
  /** 源站收到这份的时刻 */
  pushedAt: number;
};

/** Completed HealthKit workouts; epoch milliseconds, SI distance, active duration. */
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

/**
 * Pulse 公开出口的线上格式：**按列**，时刻是**相对 `window.from` 的整秒**。
 *
 * 窗口内区间很多，按对象逐条发的话，同一组字段名在首屏 HTML 与 RSC 里要重复上千遍，
 * 比数据本身还大；毫秒戳也换成短得多的相对秒（泳道和悬停只精确到分钟）。
 * 各列等长，第 i 行就是各列的第 i 个。卡片用 lib/pulse-columns 还原成行对象再画。
 * 还原时刻：`window.from + startSec * 1000`。
 *
 * **没有段的时间就是未知**（没有观测），和观测到的空闲 / 离线（state 0、0 瓦）不同。
 */
export type PulseSpanColumns = { startSec: number[]; endSec: number[] };

/** Coding 三色带：0 两者都没有，1 只有前台 coding 应用，2 只有 agent，3 两者同时 */
export type PulseCodingLane = {
  kind: "coding";
  segments: PulseSpanColumns & { value: number[] };
  /** Jev 的窗口评估：强度 0–4、置信度、模式；只在悬停里出现 */
  assessments: PulseSpanColumns & { intensity: number[]; confidence: number[]; mode: (string | null)[] };
  summary: { humanSeconds: number; agentSeconds: number; bothSeconds: number };
};

/**
 * 状态道。listening / watching：0 空闲，1 暂停，2 在放；gaming：0 离线，1 在线，2 在游戏里。
 * `title` 是曲名 / 片名 / 游戏名，`subtitle` 是艺人 / 集数。
 */
export type PulseStateLane = {
  kind: "state";
  segments: PulseSpanColumns & { state: number[]; title: (string | null)[]; subtitle: (string | null)[] };
  /**
   * 只有 listening 有：「最近在听」列表变动，只知道落在 `(start, end]` 之间某处，
   * 放的是 `title`（专辑 / 歌单）。如实画成不确定区间，不当成此刻在放。
   */
  uncertain?: PulseSpanColumns & { title: (string | null)[]; subtitle: (string | null)[] };
  /** activeSeconds：state 2 的总时长；titles：state 2 里出现过几个不同的标题 */
  summary: { activeSeconds: number; titles: number };
};

/** 实测瓦数：每段一个读数，段之间的空当是断流（未知） */
export type PulsePowerLane = {
  kind: "power";
  segments: PulseSpanColumns & { watts: number[] };
  /** 此刻的读数；最后一笔已过有效期就是 null */
  currentPowerW: number | null;
  summary: { peakW: number | null; energyWh: number };
};

/** HealthKit 五分钟桶里的步数，加上已完成训练的区间与项目名 */
export type PulseStepsLane = {
  kind: "steps";
  buckets: PulseSpanColumns & { steps: number[] };
  workouts: PulseSpanColumns & { activityType: string[] };
  summary: { steps: number };
};

/**
 * coding agent 的 token 速率：各来源、各 agent、各模型相加后的五分钟桶，不带模型名和来源。
 * `fresh` = input + output + cache 写入（新处理的 token）；cache 读量级大一两个数量级，单列只进悬停。
 * 只出有用量的桶；首桶被窗口截断就丢，末桶截到有数来源里最晚的覆盖终点，太短不画
 * （`TOKEN_MIN_SPAN_MS`，lib/pulse）。
 */
export type PulseTokensLane = {
  kind: "tokens";
  buckets: PulseSpanColumns & { fresh: number[]; output: number[]; cacheRead: number[] };
  summary: {
    /** 画出来的桶里最大的 fresh 速率（tokens/min，桶长按截断后的实长算） */
    peakPerMinute: number | null;
    /**
     * 最后一个桶在 generatedAt 前 `TOKEN_CURRENT_MS`（lib/pulse）内结束时它的速率；否则
     * 任一来源的覆盖到了 generatedAt − `TOKEN_CURRENT_MS` 就是 0；都没有是 null（未知）
     */
    currentPerMinute: number | null;
    /** 窗口内 fresh 合计 */
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
