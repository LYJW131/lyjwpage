import { recordCodingObservation } from "@api/stores/coding-pulse";
import { isCodingApp } from "@shared/pulse-levels";
import { chargingLevel, codingLevel, listeningLevel } from "@shared/pulse-levels";
import { chargerPushPayload } from "@/lib/anker";
import { readChargerState } from "@/lib/charger-store";
import {
  normalizeChargingDevice,
  normalizePowerBank,
  pickCharger,
  pickPowerBank,
  type RawChargingDevices,
} from "@/lib/charging-device";
import { askSettlingAt, settlingDecision } from "@/lib/charging-settling";
import {
  getHomePodSnapshot,
  playableHomePod,
  type StoredHomePod,
} from "@/lib/homepod-store";
import { number, object, text } from "@/lib/json";
import { chargerActive, liveTrack, powerBankActive } from "@/lib/home-layout";
import { CHARGER_TAG, DESKTOP_TAG, NOW_LISTENING_TAG, POWERBANK_TAG, VIBECODING_TAG } from "@/lib/live-events";
import { pickNowListening } from "@/lib/now-listening";
import {
  normalizePlayingQueue,
  upcomingQueueTracks,
  type PlayingQueueTrack,
} from "@/lib/playing-queue";
import { powerBankPushPayload } from "@/lib/powerbank";
import { readPowerBankState } from "@/lib/powerbank-store";
import { IMAGE_OBJECT_KEY } from "@/lib/asset-url";
import { VIBECODING_STALE_MS } from "@/lib/freshness";
import { nextLiveness, readLiveness, type Liveness } from "@/lib/reporter-liveness";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@/lib/types";
import type {
  ChargerStatus,
  LocalNowPlaying,
  PowerBankStatus,
  StoredVibeCodingYear,
  TimezoneActivity,
  VibeCodingNowPayload,
} from "@/lib/types";
import { fanout, type PendingEvent } from "@api/fanout";
import type { ListeningEffect } from "@api/ingest-effects";
import { recordPulse } from "@api/stores/pulse";
import { parseAppleMusicCredentials } from "@api/apple-music-credentials-module";
import { putAppleMusicCredentials } from "@api/stores/apple-music-credentials";
import { prepareHeartbeat, prepareStatus } from "@api/stores/charger-store";
import { writeSettlingAt } from "@api/stores/charging-settling";
import { prepareStatus as preparePowerBankStatus } from "@api/stores/powerbank-store";
import { writeLiveness } from "@api/stores/reporter-liveness";
import { prepareVibeCodingNow, prepareVibeCodingNowPayload, prepareVibeCodingUsage, prepareVibeCodingUsagePayload } from "@api/stores/vibecoding";
import { prepareVibeCodingYear, prepareVibeCodingYearPayload } from "@api/stores/vibecoding-year-store";
import type { ParsedVibeCodingNow, ParsedVibeCodingUsage } from "@/lib/vibecoding-parse";
import { nowMirror } from "@shared/vibecoding";
import { activeDesktop, DESKTOP_ICON_CACHE_LIMIT, desktopPayload, mirror, type PersistedTelemetry, bareSnapshotFrom, type StoredDesktopActivity, syncTelemetryState, telemetryState } from "@shared/telemetry";

type TelemetryPatch = {
  desktop?: StoredDesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone?: TimezoneActivity | null;
  music?: LocalNowPlaying | null;
  upcomingTracks?: PlayingQueueTrack[];
};

async function persistTelemetryState(
  receivedAt: number,
  patch: TelemetryPatch,
  activeModules: string[],
) {
  const incoming: PersistedTelemetry = {
    desktop: "desktop" in patch ? (patch.desktop ?? null) : telemetryState.desktop,
    desktopIconAssets:
      patch.desktopIconAssets ?? [...telemetryState.desktopIconAssets],
    timezone: "timezone" in patch ? (patch.timezone ?? null) : telemetryState.timezone,
    music: "music" in patch ? (patch.music ?? null) : telemetryState.music,
    upcomingTracks:
      "upcomingTracks" in patch ? (patch.upcomingTracks ?? []) : telemetryState.upcomingTracks,
    activityReceivedAt:
      "desktop" in patch || "music" in patch
        ? receivedAt
        : telemetryState.activityReceivedAt,
    timezoneReceivedAt: "timezone" in patch ? receivedAt : telemetryState.timezoneReceivedAt,
    telemetryReceivedAt: receivedAt,
    activeModules,
  };

  const fields: (keyof PersistedTelemetry & string)[] = ["telemetryReceivedAt", "activeModules"];
  if ("desktop" in patch) fields.push("desktop", "desktopIconAssets", "activityReceivedAt");
  else if ("desktopIconAssets" in patch) fields.push("desktopIconAssets");
  if ("timezone" in patch) fields.push("timezone", "timezoneReceivedAt");
  if ("music" in patch) fields.push("music", "upcomingTracks", "activityReceivedAt");

  await mirror.merge(incoming, fields);
}

type TelemetryEnvelope = {
  presence?: unknown;
  version?: unknown;
  heartbeatAt?: unknown;
  activeModules?: unknown;
  modules?: unknown;
};

type PreparedDesktop = {
  activity: StoredDesktopActivity | null;
  iconHash: string | null;
  iconObjectKey: string | null;
};

export type PreparedTelemetryEnvelope = {
  source: "mac";
  receivedAt: number;
  presence: "online" | "offline";
  activeModules: string[];
  modules: {
    chargingDevices?: {
      charger: ChargerStatus | null;
      powerBank: PowerBankStatus | null;
      failureAfterCharger?: string;
    };
    desktop?: PreparedDesktop;
    timezone?: TimezoneActivity | null;
    appleMusic?: { music: LocalNowPlaying | null; upcomingTracks: PlayingQueueTrack[] };
    appleMusicCredentials?: { musicUserToken: string };
    vibeCodingUsage?: ParsedVibeCodingUsage;
    vibeCodingNow?: ParsedVibeCodingNow;
    vibeCodingYear?: Omit<StoredVibeCodingYear, "pushedAt">;
  };
  /** 晚模块失败仍要让 DO 在原执行位置抛错，保留此前已承诺的写。 */
  failure?: {
    stage: "beforeCharging" | "beforeDesktop" | "beforeTimezone" | "beforeAppleMusic" | "beforeAppleMusicCredentials";
    message: string;
  };
};

function milliseconds(value: unknown, fallback = Date.now()) {
  const parsed = number(value);
  if (parsed == null) return fallback;
  return parsed > 1e12 ? parsed : parsed * 1000;
}

/** Map 的插入顺序顺便充当 LRU；每次命中或更新都把该项移到末尾。 */
function rememberDesktopIcon(hash: string, objectKey: string) {
  telemetryState.desktopIconAssets.delete(hash);
  telemetryState.desktopIconAssets.set(hash, objectKey);
  if (telemetryState.desktopIconAssets.size > DESKTOP_ICON_CACHE_LIMIT) {
    const oldest = telemetryState.desktopIconAssets.keys().next().value;
    if (oldest !== undefined) telemetryState.desktopIconAssets.delete(oldest);
  }
}

function normalizeDesktop(
  value: unknown,
  receivedAt: number,
): PreparedDesktop {
  const row = object(value);
  if (!row) return { activity: null, iconHash: null, iconObjectKey: null };
  const applicationName = text(row.applicationName);
  if (!applicationName) throw new Error("desktop 模块缺少 applicationName");
  const bundleIdentifier = text(row.bundleIdentifier);
  const windowTitle = normalizeWindowTitle(row.windowTitle, bundleIdentifier);
  const iconHash = text(row.iconHash);
  if (iconHash != null && !/^[a-f0-9]{64}$/.test(iconHash)) {
    throw new Error("desktop.iconHash 必须是 SHA-256 十六进制字符串");
  }
  /**
   * 两个哈希各司其职，不是同一个东西，别再把它们对等起来。
   *
   * - `iconHash` 是**这个应用的图标**的身份：应用有图标它就非空，哪怕编码失败、
   *   还没传上去。站点靠它当 desktopIconAssets 的键。
   * - `iconObjectKey` 是**已经躺在 R2 里的那份字节**的内容地址，直传成功才有。
   *
   * 从前两者都取自压缩后的字节，于是「这个应用没有图标」和「图标没准备好」
   * 都表现为 iconHash 为空 —— 下面的 iconAvailable 把后者也当成了「一切正常」，
   * 上报器再也收不到补传信号。实测因此静默丢了整整一批图标。
   */
  const iconObjectKey = text(row.iconObjectKey);
  if (iconObjectKey != null && !IMAGE_OBJECT_KEY.test(iconObjectKey)) {
    throw new Error("desktop.iconObjectKey 必须是 <sha256>.png 或 <sha256>.webp");
  }
  if (iconObjectKey != null && iconHash == null) {
    throw new Error("desktop.iconObjectKey 必须和 iconHash 一起上报");
  }

  if (row.iconData != null) throw new Error("desktop.iconData 已停用，请由上报器直传 R2");

  // 上报器一次性编好小图并直传 R2，只把对象键发回来。对象键落 SQLite，读取 /
  // 推送时才拼成 `/img/<键>` 这条同源路径，交付域由访客域名的边缘决定，
  // 见 lib/asset-url。
  //
  // 站点不在名称上报的热路径里 HEAD：上报器在后台 resolver 里先查后写，
  // 并按五分钟窗口复验，桶被清空时由它原地补回同一个内容地址。这里信任它
  // 已确认的对象键，避免图片存储的一次慢响应拖住整次前台切换。
  return {
    activity: {
      applicationName,
      bundleIdentifier,
      windowTitle,
      iconObjectKey: null,
      observedAt: milliseconds(row.observedAt, receivedAt),
    },
    iconHash,
    iconObjectKey,
  };
}

/** 窗口标题的长度上限，按码点算。够放完整的文件路径或网页标题，又不至于当作日志用。 */
const WINDOW_TITLE_MAX = 200;

/**
 * 当前窗口标题。缺席、null、空白都归 null —— 「没有标题」只有这一种表示。
 *
 * 类型不对要炸：标题是上报侧直接透传的系统值，收到数字或对象说明那边的取值
 * 路径错了，静默收敛成 null 只会让它一直错下去。超长则截断不报错，标题长短
 * 由用户此刻打开的文件决定，不是上报器的毛病。
 *
 * 按码点截：CJK 和 emoji 的标题很常见，按 UTF-16 码元切会把代理对劈成两半，
 * 留下一个永远画不出来的半字符。
 *
 * 前台应用被隐藏时强制清空：占位 bundle id 的意思就是「这一刻不许对外说我在干
 * 什么」，应用名已经是占位符，标题不跟着清等于从后门把它漏出去。
 */
function normalizeWindowTitle(value: unknown, bundleIdentifier: string | null) {
  if (value != null && typeof value !== "string") {
    throw new Error("desktop.windowTitle 必须是字符串或 null");
  }
  if (bundleIdentifier === HIDDEN_DESKTOP_BUNDLE_ID) return null;
  const title = text(value);
  if (title == null) return null;
  const points = [...title];
  return points.length > WINDOW_TITLE_MAX
    ? points.slice(0, WINDOW_TITLE_MAX).join("")
    : title;
}

function normalizeTimezone(
  value: unknown,
  receivedAt: number,
): TimezoneActivity | null {
  const row = object(value);
  if (!row) return null;
  const identifier = text(row.identifier);
  if (!identifier) return null;
  return {
    identifier,
    abbreviation: text(row.abbreviation),
    secondsFromGMT: Math.trunc(number(row.secondsFromGMT) ?? 0),
    observedAt: milliseconds(row.observedAt, receivedAt),
  };
}

function normalizeMusic(
  value: unknown,
  receivedAt: number,
): LocalNowPlaying | null {
  const row = object(value);
  if (!row) return null;
  const rawState = text(row.state);
  const state = rawState === "playing" || rawState === "paused" ? rawState : "stopped";
  const trackId = text(row.trackId);
  return {
    source: "apple-music",
    state,
    title: text(row.title),
    artist: text(row.artist),
    album: text(row.album),
    trackId,
    // 采集端不再上传封面二进制：读取时会查一次 Apple Music 目录拿曲目链接，
    // 那次查询的结果自带封面 URL，见 getNowListening
    artworkUrl: null,
    positionMs: Math.max(0, number(row.positionMs) ?? 0),
    durationMs: Math.max(0, number(row.durationMs) ?? 0),
    // 上报器发的是布尔值，字符串那支是给旧版采集器留的；缺字段按「不循环」处理
    repeatOne: text(row.repeatOne) === "true" || row.repeatOne === true,
    observedAt: milliseconds(row.observedAt, receivedAt),
  };
}

export function prepareTelemetryEnvelope(input: unknown, receivedAt = Date.now()): PreparedTelemetryEnvelope {
  const envelope = object(input) as TelemetryEnvelope | null;
  if (!envelope || envelope.version !== 4) throw new Error("遥测协议 version 必须为 4");
  if (number(envelope.heartbeatAt) == null) throw new Error("遥测请求缺少 heartbeatAt");
  if (!Array.isArray(envelope.activeModules)) throw new Error("遥测请求缺少 activeModules");
  const activeModules = envelope.activeModules.filter(
    (value): value is string => typeof value === "string",
  );
  if (activeModules.length !== envelope.activeModules.length) {
    throw new Error("activeModules 只能包含字符串");
  }
  const presence = text(envelope.presence);
  if (presence !== "online" && presence !== "offline") {
    throw new Error("遥测请求的 presence 必须是 online 或 offline");
  }
  const normalizedPresence: "online" | "offline" = presence;
  if (envelope.modules != null && !object(envelope.modules)) {
    throw new Error("遥测请求的 modules 必须是对象");
  }
  const raw = object(envelope.modules) ?? {};

  // 这三份原本就先全校验；任一坏掉时连 liveness 都不落，保持既有契约。
  const codingUsage = "vibeCodingUsage" in raw
    ? prepareVibeCodingUsage(raw.vibeCodingUsage, receivedAt).payload
    : undefined;
  const codingNow = "vibeCodingNow" in raw
    ? prepareVibeCodingNow(raw.vibeCodingNow, receivedAt).payload
    : undefined;
  const codingYear = "vibeCodingYear" in raw
    ? prepareVibeCodingYear(raw.vibeCodingYear, receivedAt).payload
    : undefined;

  const modules: PreparedTelemetryEnvelope["modules"] = {};
  const fail = (
    stage: NonNullable<PreparedTelemetryEnvelope["failure"]>["stage"],
    error: unknown,
  ): PreparedTelemetryEnvelope => ({
    source: "mac" as const,
    receivedAt,
    presence: normalizedPresence,
    activeModules,
    modules,
    failure: { stage, message: error instanceof Error ? error.message : String(error) },
  });

  if ("chargingDevices" in raw) {
    try {
      const devices = object(raw.chargingDevices) as RawChargingDevices | null;
      if (!devices) throw new Error("chargingDevices 模块必须是对象");
      const charger = pickCharger(devices);
      if (charger && !charger.updatedAt) throw new Error("chargingDevices 里的充电头缺少 updatedAt");
      modules.chargingDevices = {
        charger: charger ? normalizeChargingDevice(charger) : null,
        powerBank: null,
      };
      try {
        const powerBank = pickPowerBank(devices);
        if (powerBank && !powerBank.updatedAt) {
          throw new Error("chargingDevices 里的充电宝缺少 updatedAt");
        }
        modules.chargingDevices.powerBank = powerBank ? normalizePowerBank(powerBank) : null;
      } catch (error) {
        modules.chargingDevices.failureAfterCharger =
          error instanceof Error ? error.message : String(error);
        return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, modules };
      }
    } catch (error) {
      return fail("beforeCharging", error);
    }
  }
  if ("desktop" in raw) {
    try { modules.desktop = normalizeDesktop(raw.desktop, receivedAt); }
    catch (error) { return fail("beforeDesktop", error); }
  }
  if ("timezone" in raw) {
    try { modules.timezone = normalizeTimezone(raw.timezone, receivedAt); }
    catch (error) { return fail("beforeTimezone", error); }
  }
  if ("appleMusic" in raw) {
    try {
      const musicRow = object(raw.appleMusic);
      const music = normalizeMusic(raw.appleMusic, receivedAt);
      modules.appleMusic = {
        music,
        upcomingTracks: musicRow ? upcomingFromMusicRow(musicRow, music?.title ?? null) : [],
      };
    } catch (error) {
      return fail("beforeAppleMusic", error);
    }
  }
  if ("appleMusicCredentials" in raw) {
    try {
      modules.appleMusicCredentials = parseAppleMusicCredentials(raw.appleMusicCredentials);
    } catch (error) {
      return fail("beforeAppleMusicCredentials", error);
    }
  }
  if (codingUsage) modules.vibeCodingUsage = codingUsage;
  if (codingNow) modules.vibeCodingNow = codingNow;
  if (codingYear) modules.vibeCodingYear = codingYear;

  return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, modules };
}

function upcomingFromMusicRow(row: Record<string, unknown>, title: string | null) {
  return upcomingQueueTracks(normalizePlayingQueue(row.queue), title);
}

/**
 * Mac 上报器的唯一入口。
 *
 * 一个 envelope 可以只更新一个模块，未出现的模块保持原快照；modules 整个省略
 * （或给个空对象）就是一次纯心跳 —— 靠 presence 和 heartbeatAt 起作用。
 *
 * 从前心跳和优雅下线走另一个 presence 端点，于是「上报器还活着」这一件事有
 * 两份实现，连记账顺序都是各排各的（一个先 declare 后 mark，一个反过来）。
 * 现在只有这一条路：每条信封都刷新存活，声明翻转时发一次 presence 事件。
 */
export async function recordTelemetryEnvelope(input: unknown, receivedAt = Date.now()) {
  return commitPreparedTelemetryEnvelope(prepareTelemetryEnvelope(input, receivedAt));
}

export async function commitPreparedTelemetryEnvelope(command: PreparedTelemetryEnvelope) {
  const { receivedAt, presence, activeModules: nextActiveModules, modules } = command;
  const codingUsage = modules.vibeCodingUsage
    ? prepareVibeCodingUsagePayload(modules.vibeCodingUsage, receivedAt)
    : null;
  const codingNow = modules.vibeCodingNow
    ? prepareVibeCodingNowPayload(modules.vibeCodingNow, receivedAt)
    : null;
  const codingYear = modules.vibeCodingYear
    ? prepareVibeCodingYearPayload(modules.vibeCodingYear, receivedAt)
    : null;

  /**
   * 这封信封用得着的键，**全部在这里一起发车**。
   *
   * 同一条 HTTP 存储客户端 连接上并发发出的命令在网络上是重叠的，所以这几条加起来
   * 只花一个来回 —— 不用真去组 pipeline。关键是「决定读什么」必须早于
   * 「分发模块」：从前充电头那两条读是分支里现读的，于是它排在状态和存活
   * 后面，一封带充电头的信封要三个背靠背的来回才轮到推送。
   *
   * 只读这封用得上的：`charger:history` 是 400 个采样点、十几 KB，无条件读回来
   * 再丢掉，比多一个来回还亏。
   */
  const hasChargingDevices = "chargingDevices" in modules;
  const wantsCharger = hasChargingDevices || nextActiveModules.includes("charger");
  const charger = wantsCharger ? readChargerState() : null;
  /**
   * 两台设备各自的「上一次结构变化在什么时候」，收敛窗口要用（lib/charging-settling）。
   * 结构真变了的话这两条是白读的，但它们和上面几条在同一批里，不多花来回。
   */
  const settling = hasChargingDevices
    ? { charger: askSettlingAt("charger"), powerbank: askSettlingAt("powerbank") }
    : null;
  const powerBank = hasChargingDevices ? readPowerBankState() : null;
  /**
   * 这两条每封都要，包括纯心跳：在听和 coding 的档位每封重算一次（见下面那段
   * pulse 的注释），而仲裁「谁在放」要 HomePod 那份快照，算 coding 要此刻的
   * agents。放在这里和存活、工作副本同一批发车，心跳不会因此多一个来回。
   */
  const homePod = getHomePodSnapshot();
  const storedCodingNow = codingNow ? null : nowMirror.get();
  const [, previousLiveness] = await Promise.all([syncTelemetryState(), readLiveness()]);

  // 落 activeModules 必须排在 syncTelemetryState 后面 —— 它会从库里那份覆盖回来
  telemetryState.activeModules = new Set(nextActiveModules);
  /**
   * envelope.presence 是上报器声明的在离线。
   *
   * 只覆盖优雅离开：退出、睡眠时它抢在断开前发一条 offline，这里立刻把状态
   * 翻过去，不用等心跳窗口。崩溃、断网、强制关机时它发不出这一条，
   * 那些仍然靠 offlineByLiveness 里的心跳窗口兜底 —— 两条路是互补的。
   *
   * 任何一条信封本身都算一次在线心跳；offline 只用于睡眠、退出这类优雅离开。
   */
  const { next: liveness, flipped: presenceFlipped } = nextLiveness(previousLiveness, {
    offline: presence === "offline",
    at: receivedAt,
  });

  /**
   * 这一轮要做的三件事，收集起来一起交给 fanout：写和推同时发车，缓存失效排在
   * 它们之后。先后为什么必须是这样，见 lib/live-events 的 fanout。
   *
   * 从前是逐个 await：每一次推送前面都压着一串 SQLite 往返，而推送本身要的东西
   * 这时早就在手上了。
   */
  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const notify: PendingEvent[] = [];
  const listening: ListeningEffect[] = [];
  const tags: string[] = [];
  // 这三组都依赖 telemetry fields 真正落库；较晚模块失败时不能推一份未持久化状态。
  const telemetryEvents: PendingEvent[] = [];
  const telemetryListening: ListeningEffect[] = [];
  const telemetryTags: string[] = [];

  let accepted = 0;
  let desktopIconAvailable: boolean | undefined;
  let chargerCoverIconAvailable: boolean | undefined;
  const patch: TelemetryPatch = {};

  /**
   * 存活第一个发车，而且排在模块处理**外面**。
   *
   * 「任何一条信封本身都算一次在线心跳」—— 哪怕其中一个模块写坏了。放进下面
   * 那个 try 里的话，上报器一旦带出个格式错误，每封都 400、每封都不记心跳，
   * 90 秒后整台 Mac 的卡全变灰，而它其实活得好好的、别的模块也还在正常落库。
   * 从前 recordReporterBeat 就排在模块前面，这里保持不变。
   */
  writes.push(writeLiveness(liveness));

  /**
   * 在离线翻转本身就是状态变化，值得推 —— 这正是「关键事件」，不是定时广播。
   *
   * 这一条不带数据，浏览器收到后要回源重取三份（PRESENCE_PATHS：desktop /
   * listening-now / charger），所以它得排在写后面，交给 fanout 的 `notify`。
   * 时区不看存活，上下线不用刷它的首屏缓存。
   *
   * 这几行排在模块处理**外面**，和上面那次心跳同一个理由：翻转是这封信封确实
   * 带来的变化，哪怕其中一个模块写坏了也已经写进存活里了，浏览器不该只能等下一轮
   * 轮询才翻过来 —— fanout 的失效和通知都在 `finally` 里，写抛出去也照发。
   */
  if (presenceFlipped) {
    notify.push({ type: "presence", payload: null });
    tags.push(DESKTOP_TAG);
    tags.push(NOW_LISTENING_TAG, CHARGER_TAG);
  }

  /**
   * 模块处理整个包起来，是为了保证「已经发车的写」一定被交给 fanout。
   *
   * 下面的写是 push 进 writes 就开跑的，而后面的模块还可能校验失败抛出去 ——
   * 中途 return 的话，那几个已经发车的写就没人接管了，serverless 上响应一返回
   * 随手就被掐掉，表现是「上报器报了个格式错误，顺带丢了同一封里已经收下的
   * 另外几份数据」。错误照样往上抛，只是先把该落的交出去。
   *
   * 注意等它们的不再是这一层：fanout 走 after()，写和推送都在响应之后跑
   * （见 lib/live-events 的 afterResponse），保住它们的是平台的 waitUntil。
  */
  try {
    if (command.failure?.stage === "beforeCharging") {
      throw new Error(command.failure.message);
    }
    /**
     * 充电设备。
     *
     * 上报器 v5 起送的是 `chargingDevices`：一个设备列表，充电头和充电宝在同一个
     * 数组里，靠 `kind` 区分。两台各自落库、各自推送 —— 一台没在列表里不影响另
     * 一台，那正是「只开了其中一个模块」的正常情况。
     *
     * 旧的 `charger` 键已经停发。这里不做兼容：留一条读不到新字段的旧路径，只会
     * 在上报器回滚时安静地写进半截数据。
     */
    let chargerWritten = false;
    if ("chargingDevices" in modules) {
      const device = modules.chargingDevices?.charger ?? null;
      // 只开了充电宝模块时列表里就没有充电头。那不是错误，收下心跳即可。
      if (device) {
        let status = device;
        if (status.cover?.iconHash && status.cover.iconObjectKey) {
          rememberDesktopIcon(status.cover.iconHash, status.cover.iconObjectKey);
        }
        if (status.cover?.iconHash) {
          const storedKey = telemetryState.desktopIconAssets.get(status.cover.iconHash) ?? null;
          if (storedKey) rememberDesktopIcon(status.cover.iconHash, storedKey);
          status = {
            ...status,
            cover: { ...status.cover, iconObjectKey: storedKey },
          };
        }
        chargerCoverIconAvailable =
          status.cover?.iconHash == null || status.cover.iconObjectKey != null;
        if (status.cover?.iconHash) {
          patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
        }
        // 上面早就发车了，这里只是把它接住
        const chargerState = await (charger ?? readChargerState());
        const landing = prepareStatus(status, receivedAt, chargerState);
        writes.push(landing.commit());
        writes.push(recordChargingPulse(receivedAt, status));
        chargerWritten = true;
        /**
         * 插拔、换设备立刻推给浏览器，不等卡片下一次轮询。滚动读数照旧不走这里 ——
         * 除了插拔后那几十秒：采集端在那段时间会追发，功率还在往稳定值收敛，
         * 那几帧值得推。窗口的判断见 lib/charging-settling。
         */
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.charger ?? askSettlingAt("charger")),
        );
        if (window.restart) writes.push(writeSettlingAt("charger", receivedAt));
        if (window.publish) {
          events.push({
            type: "charger",
            payload: chargerPushPayload({
              status,
              receivedAt,
              historyCount: landing.historyCount,
              liveness,
            }),
          });
        }
        // 首屏只关心这一格亮没亮：插着线的功率滚动、收敛窗口里那几帧都只走推送
        if (chargerActive(chargerState.previous?.status) !== chargerActive(status)) tags.push(CHARGER_TAG);
      }

      if (modules.chargingDevices?.failureAfterCharger) {
        throw new Error(modules.chargingDevices.failureAfterCharger);
      }

      const bank = modules.chargingDevices?.powerBank ?? null;
      if (bank) {
        const status = bank;
        const previousBank = await (powerBank ?? readPowerBankState());
        const landing = preparePowerBankStatus(status, receivedAt, previousBank);
        writes.push(landing.commit());
        // 和充电头同一套：插拔、充放电切换、热控翻转、整数电量跳格即时推，加上
        // 插拔之后那段收敛窗口；缓慢滚动的电量和功率仍然等下一次轮询。
        const window = settlingDecision(
          landing.structuralChanged,
          receivedAt,
          await (settling?.powerbank ?? askSettlingAt("powerbank")),
        );
        if (window.restart) writes.push(writeSettlingAt("powerbank", receivedAt));
        if (window.publish) {
          events.push({
            type: "powerbank",
            payload: powerBankPushPayload({ status, receivedAt, liveness }),
          });
        }
        if (powerBankActive(previousBank?.status) !== powerBankActive(status)) tags.push(POWERBANK_TAG);
      }
      accepted += 1;
    }
    /**
     * 充电头按「多久没收到推送」判断断流，纯心跳也得给它续上。
     *
     * 上面真收下快照时不用再来一次：prepareStatus 那条 pipeline 里已经把这个心跳
     * 一起落了。从前两条都发，于是每个带充电头的信封都白跑一次写加两次读。
     */
    if (!chargerWritten && charger && nextActiveModules.includes("charger")) {
      const state = await charger;
      writes.push(prepareHeartbeat(receivedAt, state).commit());
      /**
       * 档位也跟着续。这段时间卡片照旧显示留着的那份快照（过期只由存活和
       * pushedAt 判，而这条心跳正在续 pushedAt），pulse 不跟着确认的话，
       * 序列会在「还插着、还在充」的中间断成一个看起来像上报器死了的缺口。
       */
      if (state.previous) writes.push(recordChargingPulse(receivedAt, state.previous.status));
    }

    if (command.failure?.stage === "beforeDesktop") {
      throw new Error(command.failure.message);
    }

    if ("desktop" in modules) {
      const normalized = modules.desktop!;
      if (normalized.iconObjectKey && normalized.iconHash) {
        rememberDesktopIcon(normalized.iconHash, normalized.iconObjectKey);
      }
      const storedIconObjectKey = normalized.iconHash
        ? (telemetryState.desktopIconAssets.get(normalized.iconHash) ?? null)
        : null;
      if (normalized.iconHash && storedIconObjectKey) {
        rememberDesktopIcon(normalized.iconHash, storedIconObjectKey);
      }
      const activity = normalized.activity
        ? { ...normalized.activity, iconObjectKey: storedIconObjectKey }
        : null;
      desktopIconAvailable = normalized.iconHash == null || storedIconObjectKey != null;
      // 名字立刻推。图标没就位也推 —— 卡着不发的话页头会停在上一个应用，
      // 比短暂的占位符更糟。desktopIconAvailable 仍然回给上报器，让它补图。
      telemetryState.desktop = activity;
      telemetryState.activityReceivedAt = receivedAt;
      patch.desktop = activity;
      patch.desktopIconAssets = [...telemetryState.desktopIconAssets];
      accepted += 1;
      // 页头那一格定宽，换应用只换内容，首屏交给定时重建；上下线的翻转在上面单独失效
      telemetryEvents.push({ type: "desktop", payload: desktopPayload(liveness) });
    }

    if (command.failure?.stage === "beforeTimezone") {
      throw new Error(command.failure.message);
    }

    if ("timezone" in modules) {
      telemetryState.timezone = modules.timezone ?? null;
      telemetryState.timezoneReceivedAt = receivedAt;
      patch.timezone = telemetryState.timezone;
      // 没有推送事件（时区一年变两次），也不失效首屏：卡片定高，换时区只换内容，
      // 定时重建会带上，浏览器挂载后也直接问 Worker
      accepted += 1;
    }

    if (command.failure?.stage === "beforeAppleMusic") {
      throw new Error(command.failure.message);
    }

    if ("appleMusic" in modules) {
      const { music, upcomingTracks } = modules.appleMusic!;
      const wasLive = liveTrack(telemetryState.music) != null;
      telemetryState.music = music;
      telemetryState.upcomingTracks = upcomingTracks;
      telemetryState.activityReceivedAt = receivedAt;
      patch.music = music;
      patch.upcomingTracks = upcomingTracks;
      accepted += 1;
      /**
       * 只把本次提交对应的 Mac / HomePod 快照收进 effect。StateHub 确认写入后，
       * 普通 Worker 才查 Apple 目录并广播；后台不重读“当前曲目”，避免串到下一封。
       */
      telemetryListening.push(
        listeningEffect(liveness, playableHomePod(await homePod), {
          music,
          receivedAt,
          upcomingTracks,
        }),
      );
      // 换歌、进度只换 hero 里的内容；开始 / 停止放歌才换掉整块 hero
      if (wasLive !== (liveTrack(music) != null)) telemetryTags.push(NOW_LISTENING_TAG);
    }

    if (command.failure?.stage === "beforeAppleMusicCredentials") {
      throw new Error(command.failure.message);
    }

    if ("appleMusicCredentials" in modules) {
      // 只有 music user token 来自那台 Mac；developer token 由 Worker 自签，见 musickit-token.ts
      const { musicUserToken } = modules.appleMusicCredentials!;
      writes.push(putAppleMusicCredentials({ musicUserToken, receivedAt }));
      accepted += 1;
    }

    /**
     * Vibe coding 两个模块各收各的，按「多久变一次」分：
     * `vibeCodingUsage` 是十几分钟一份的累计量，`vibeCodingNow` 是 60 秒一轮的
     * 此刻状态，只有后者值得推给浏览器。理由见 lib/vibecoding 的模块注释。
     *
     * 两份拼成同一张首屏卡片。只有累计量会增减行、换出总量和常用模型两块，
     * 所以只有它报缓存 tag；真正发不发由出口按卡片骨架再筛一遍，见 live-platform。
     * 三份 coding 模块已经在入口一起校验，这里只提交。
     */
    if (codingUsage) {
      writes.push(codingUsage.commit());
      tags.push(VIBECODING_TAG);
      accepted += 1;
    }

    if (codingNow) {
      const { now, commit } = codingNow;
      writes.push(commit());
      // 此刻只改已有那几行的灯和模型，行从用量和限额来：只推送，不失效首屏
      events.push({ type: "vibecoding-now", payload: now });
      accepted += 1;
    }

    /**
     * 年度热力图单独一块。不推送 —— 格子按天变，浏览器长间隔和切回焦点来问。
     * 上报和 GET 都是整年 371 个数一次给齐，云端补回的旧日也会刷新。
     * 也不失效首屏：格子颜色是内容，交给定时重建。
     */
    if (codingYear) {
      writes.push(codingYear.commit());
      accepted += 1;
    }

    /**
     * 在听和 coding 每封都重算一笔，纯心跳也算。
     *
     * 采集端只在内容变化时才带上对应模块，所以「这封没带 appleMusic / desktop」
     * 说的是「没变」，不是「没在听、没在写」。从前这两笔挂在模块出现上，于是一首
     * 长歌、一段稳定的 coding 整段不落笔：5 分钟的再确认永远不到，暂停宽限期过了
     * 也没人把它翻成空闲 —— 序列中间看起来像上报器死了。
     *
     * 档位从留着的工作副本 + 这封算出来的存活现算，**不查 Apple 目录**
     * （bareSnapshotFrom），两笔都自己吞异常，写坏了不影响 202。
     */
    writes.push(recordListeningPulse(receivedAt, liveness, homePod));
    writes.push(recordCodingPulse(receivedAt, codingNow?.now.agents, storedCodingNow, presence === "online"));

    // 整封都收下了才落状态。中途抛出去时这份不写 —— 从前也是这样，
    // persistTelemetryState 就排在所有模块之后。存活不同，见上面。
    // 只 HSET 这封碰过的字段：心跳和换歌并发时，整包 SET 会把 SQLite 里的新歌盖回上一首。
    writes.push(persistTelemetryState(receivedAt, patch, nextActiveModules));
    events.push(...telemetryEvents);
    listening.push(...telemetryListening);
    tags.push(...telemetryTags);
  } finally {
    /**
     * 只在模块真的来了才推。
     *
     * 采集端本来就只在内容变化时才带上对应模块，所以「模块出现在 envelope 里」
     * 就是变化信号本身。从前这里是无条件推 —— 连不带任何模块的纯心跳包也推，
     * 为的是把「上报器离线」翻回在线。但过期是时间的函数，两张卡一直在轮询，
     * 那件事轮询本来就在做；为它每 30 秒广播一份没变化的状态，等于把推送当轮询用。
     *
     * 代价是上报器从离线恢复时，「在线」最迟等下一轮轮询（30 秒）才显示，不再是
     * 收到心跳的那一刻。换来的是推送通道上只跑真正的状态变化。
     */
    await fanout({ writes, events, notify, listening, tags });
  }

  return { accepted, heartbeat: true, desktopIconAvailable, chargerCoverIconAvailable };
}

/**
 * 推送当前播放。
 *
 * 暂停宽限期结束时不由这里补一条 —— 从前是挂一个 setTimeout 到点重推，
 * 那要求进程在响应发出之后还活着。serverless 上响应一返回实例就被冻结，
 * 那个定时器根本不会执行，表现是暂停后 hero 一直挂到下一次轮询才翻。
 *
 * 现在改成 payload 自带 expiresInMs，由浏览器把下一次取数排在那一刻，
 * 服务端只对「收到上报」这一件事做出反应，不欠任何未来的动作。
 *
 * 描述符只带这次提交已经捕获的 Mac、HomePod 与存活快照。普通 Worker 收到提交
 * 结果后再查 Apple 目录，不能在后台重读“当前曲目”，否则慢查询会串到下一封上报。
 */
function listeningEffect(
  liveness: Liveness,
  homePod: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks?: PlayingQueueTrack[];
  },
): ListeningEffect {
  const source = mac ?? {
    music: telemetryState.music,
    receivedAt: telemetryState.activityReceivedAt,
    upcomingTracks: telemetryState.upcomingTracks,
  };
  return {
    kind: "listening",
    liveness,
    activeModules: [...telemetryState.activeModules],
    homePod,
    mac: {
      music: source.music,
      receivedAt: source.receivedAt,
      upcomingTracks: source.upcomingTracks ?? [],
    },
  };
}

/**
 * pulse 序列只仲裁「谁在放」，不查 Apple 目录。
 *
 * HomePod 入口直接使用本次已经规范化并写入的值，不另开一次 SQLite。
 * Mac 那一侧使用已经更新好的工作副本 —— 这封带了 appleMusic 的话它正是新的那份，
 * 没带就是留着的上一份，两种情形都该按同一套规则重算一次档位。
 *
 * `now` 一律取 `receivedAt`，和样本的 `t` 同一把钟：暂停宽限、HomePod 静默、
 * 存活窗口三件事都是时间的函数，判它们的时刻必须就是这一笔记下来的时刻。
 */
async function recordListeningPulse(
  receivedAt: number,
  liveness: Liveness,
  homePod: Promise<StoredHomePod | null>,
): Promise<void> {
  try {
    const scored = listeningLevel(
      pickNowListening(bareSnapshotFrom(await homePod), liveness, receivedAt),
    );
    await recordPulse("listening", { t: receivedAt, level: scored.level, hint: scored.hint });
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

async function recordCodingPulse(
  receivedAt: number,
  incomingAgents: VibeCodingNowPayload["agents"] | undefined,
  mirrored: ReturnType<typeof nowMirror.get> | null,
  online: boolean,
): Promise<void> {
  try {
    /**
     * 留着的 agents 也要过闸，和前台应用一样：vibeCoding 模块关掉之后 nowMirror 里
     * 还是最后那份，采集器死了而 Mac 还在心跳时同样如此 —— 不挡的话最后一次
     * `active: true` 会被每 5 分钟的再确认一直算成 level 3。模块名按上报器的
     * activeModules 来（`vibeCoding`），过期线沿用卡片那条 VIBECODING_STALE_MS。
     */
    const kept = incomingAgents === undefined ? await mirrored : null;
    const agents =
      incomingAgents !== undefined
        ? incomingAgents
        : kept && telemetryState.activeModules.has("vibeCoding") && receivedAt - kept.pushedAt < VIBECODING_STALE_MS
          ? kept.payload.agents
          : null;
    /**
     * 前台应用要过 activeModules 那道闸，和 desktopPayload 同一份判断。
     * 只看工作副本非空的话，desktop 模块关掉之后留着的那份还会被下一封
     * vibeCodingNow 捡起来，把早就关掉的编辑器一直算成 level 2。
     */
    const stored = activeDesktop();
    const desktop = stored
      ? { applicationName: stored.applicationName, bundleIdentifier: stored.bundleIdentifier }
      : null;
    await recordCodingObservation({
      t: receivedAt,
      available: online && (desktop !== null || agents !== null),
      desktop: desktop ? { application: desktop.applicationName.slice(0, 80), coding: isCodingApp(desktop.bundleIdentifier, desktop.applicationName) } : null,
      agents: agents?.map((agent) => ({ id: agent.id, model: agent.currentModel?.slice(0, 80) ?? null, active: agent.active })) ?? null,
    });
    const scored = codingLevel({ agents, desktop });
    await recordPulse("coding", { t: receivedAt, level: scored.level, hint: scored.hint });
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

/** 充电头档位。同样自己吞异常 —— 序列是次要的，不能让一封好好的上报变成 500。 */
async function recordChargingPulse(receivedAt: number, status: ChargerStatus): Promise<void> {
  try {
    const scored = chargingLevel(status);
    await recordPulse("charging", { t: receivedAt, level: scored.level, hint: scored.hint, powerW: status.connected ? status.totalPower : 0 });
  } catch (error) {
    console.error("[pulse]", error instanceof Error ? error.message : String(error));
  }
}

/**
 * HomePod 那条入口：Mac 工作副本和存活一起读取。推送只收集可序列化描述符，
 * Apple 目录补充交给普通 Worker；pulse 仍在 DO 内按裸快照算档位。
 */
export function homePodListening(stored: StoredHomePod): {
  effect: Promise<ListeningEffect>;
  pulse: Promise<void>;
} {
  const ready = Promise.all([syncTelemetryState(), readLiveness()]);
  return {
    effect: ready.then(([, liveness]) =>
      listeningEffect(liveness, playableHomePod(stored)),
    ),
    pulse: ready.then(
      ([, liveness]) =>
        recordListeningPulse(
          stored.receivedAt,
          liveness,
          Promise.resolve(playableHomePod(stored)),
        ),
      (error) => {
        console.error("[pulse]", error instanceof Error ? error.message : String(error));
      },
    ),
  };
}
