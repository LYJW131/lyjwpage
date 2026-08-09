import { createHash, timingSafeEqual } from "node:crypto";

import { getChargerPayload, normalizeRawStatus, type RawStatus } from "@/lib/anker";
import { recordPushHeartbeat, recordStatus } from "@/lib/charger-store";
import { resolveTrackLookup } from "@/lib/apple-music";
import { getHomePodNowPlaying } from "@/lib/homepod-store";
import { storeImageBuffer } from "@/lib/image-store";
import { number, object, text } from "@/lib/json";
import { ASSET_URL_PREFIX } from "@/lib/image-store";
import { publish } from "@/lib/live-events";
import { mirrorKey } from "@/lib/redis";
import {
  declareReporterOffline,
  livenessSnapshot,
  markReporterSeen,
  reporterLastSeenAt,
  restoreLiveness,
  reporterOffline,
} from "@/lib/reporter-liveness";
import type {
  DesktopActivity,
  DesktopPayload,
  LocalNowPlaying,
  MusicPayload,
  TimezoneActivity,
  TimezonePayload,
} from "@/lib/types";
import { recordVibeCodingReport } from "@/lib/vibecoding";

/**
 * 前台应用图标入库前压到的最长边。
 *
 * 采集端送来的是 64pt 的 PNG（Retina 上 128px），而页面上那个位置只有 40 CSS px
 * —— 2 倍屏也只要 80。和 Emby 海报、自定义歌单封面同一个路子：压在入口，
 * 缓存里存的直接是小图。
 *
 * 不像 Emby 那样需要给缓存键加版本：资产地址是内容哈希，压缩换了字节哈希就换，
 * 地址天然失效。
 */
const ICON_MAX_DIMENSION = 96;
/**
 * 图标比照片吃质量：大片纯色加硬边缘，有损压缩的振铃在这种图上最显眼，
 * 而它本来就只有几 KB，往上调几乎不涨体积。
 */
const ICON_WEBP_QUALITY = 92;

/** 与采集端一致；缓存的是很短的内容哈希 URL，64 项也足够覆盖日常应用。 */
const DESKTOP_ICON_CACHE_LIMIT = 64;

/** 暂停超过这个时间就不再占用音乐 Hero，让下一个实时来源接管。 */
const MUSIC_PAUSE_GRACE_MS = 30_000;
let pauseExpiryTimer: ReturnType<typeof setTimeout> | null = null;

type TelemetryState = {
  desktop: DesktopActivity | null;
  desktopIconAssets: Map<string, string>;
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  activeModules: Set<string>;
};

const globalTelemetry = globalThis as typeof globalThis & {
  __lyjwTelemetryState?: TelemetryState;
};
const telemetryState = (globalTelemetry.__lyjwTelemetryState ??= {
  desktop: null,
  desktopIconAssets: new Map(),
  timezone: null,
  music: null,
  activityReceivedAt: 0,
  timezoneReceivedAt: 0,
  activeModules: new Set<string>(),
});
// 开发态热更新可能复用加字段前的 globalThis 对象。
telemetryState.desktopIconAssets ??= new Map();
/**
 * 遥测状态的持久化。
 *
 * 从前写的是临时文件（$TMPDIR/lyjwpage-telemetry-v2/activity.json），全站只有
 * 这一处这么干 —— 于是清空 Redis 对它毫无作用，连重启 dev server 都清不掉，
 * 排查冷启动时会以为清干净了其实没有。现在和别的 store 一样落 Redis，
 * 「Redis 为主、进程内存为辅」的规则见 lib/redis 的 mirrorKey。
 *
 * 存活记录跟着一起走：只存状态不存存活的话，重启后页面拿着上一次的前台应用、
 * 却认为上报器从没出现过。
 */
type PersistedTelemetry = {
  desktop: DesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  telemetryReceivedAt: number;
  declaredOffline: boolean;
  activeModules: string[];
};

const mirror = mirrorKey<PersistedTelemetry>(
  ["telemetry", "state"],
  // 「有多新」看最后一次收到上报的时刻：每次心跳都会推进它
  (state) => state.telemetryReceivedAt,
);

async function persistTelemetryState() {
  await mirror.put({
    desktop: telemetryState.desktop,
    desktopIconAssets: [...telemetryState.desktopIconAssets],
    timezone: telemetryState.timezone,
    music: telemetryState.music,
    activityReceivedAt: telemetryState.activityReceivedAt,
    timezoneReceivedAt: telemetryState.timezoneReceivedAt,
    telemetryReceivedAt: reporterLastSeenAt(),
    declaredOffline: livenessSnapshot().declaredOffline,
    activeModules: [...telemetryState.activeModules],
  });
}

function keepFreshAsset<T, K extends keyof T>(row: T | null, field: K): T | null {
  if (!row) return null;
  const url = row[field];
  if (typeof url === "string" && !url.startsWith(ASSET_URL_PREFIX)) {
    return { ...row, [field]: null };
  }
  return row;
}

/**
 * 从持久层同步一次工作副本。每个入口都先调它。
 *
 * 不是「只在启动时 hydrate 一次」—— 那正是这轮要消灭的东西：读一次就再也不问，
 * 等于让进程内存变成第二份真相，清空 Redis 也翻不动它。mirrorKey 自己会处理
 * 「Redis 不可达就用内存副本」，所以每次问的代价只是一次 GET。
 */
async function syncTelemetryState() {
  const stored = await mirror.get();
  if (!stored) {
    // 真被清空了（或从没写过），工作副本跟着归零
    telemetryState.desktop = null;
    telemetryState.desktopIconAssets = new Map();
    telemetryState.timezone = null;
    telemetryState.music = null;
    telemetryState.activityReceivedAt = 0;
    telemetryState.timezoneReceivedAt = 0;
    telemetryState.activeModules = new Set();
    restoreLiveness({ lastSeenAt: 0, declaredOffline: false });
    return;
  }
  /**
   * 丢掉不是当前格式的图片 URL。
   *
   * 这些 URL 跟着状态一起持久化，而存图的路由改过前缀 —— 存量的旧 URL 会
   * 一直指向已经删掉的路由、稳定 404，且只有等设备重新上报同一张图才会
   * 被覆盖（换歌 / 换应用才会重发）。宁可先不显示，也别挂一张裂图。
   */
  telemetryState.desktop = keepFreshAsset(stored.desktop ?? null, "iconUrl");
  telemetryState.desktopIconAssets = new Map(
    (stored.desktopIconAssets ?? [])
      .filter((entry): entry is [string, string] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[1].startsWith(ASSET_URL_PREFIX),
      )
      .slice(-DESKTOP_ICON_CACHE_LIMIT),
  );
  telemetryState.timezone = stored.timezone ?? null;
  telemetryState.music = keepFreshAsset(stored.music ?? null, "artworkUrl");
  telemetryState.activityReceivedAt = stored.activityReceivedAt ?? 0;
  telemetryState.timezoneReceivedAt = stored.timezoneReceivedAt ?? 0;
  telemetryState.activeModules = new Set(stored.activeModules ?? []);
  restoreLiveness({
    lastSeenAt: stored.telemetryReceivedAt ?? 0,
    declaredOffline: stored.declaredOffline ?? false,
  });
}

type TelemetryEnvelope = {
  presence?: unknown;
  version?: unknown;
  heartbeat_at?: unknown;
  active_modules?: unknown;
  modules?: unknown;
};

function milliseconds(value: unknown, fallback = Date.now()) {
  const parsed = number(value);
  if (parsed == null) return fallback;
  return parsed > 1e12 ? parsed : parsed * 1000;
}

/** Map 的插入顺序顺便充当 LRU；每次命中或更新都把该项移到末尾。 */
function rememberDesktopIcon(hash: string, url: string) {
  telemetryState.desktopIconAssets.delete(hash);
  telemetryState.desktopIconAssets.set(hash, url);
  if (telemetryState.desktopIconAssets.size > DESKTOP_ICON_CACHE_LIMIT) {
    const oldest = telemetryState.desktopIconAssets.keys().next().value;
    if (oldest !== undefined) telemetryState.desktopIconAssets.delete(oldest);
  }
}

async function normalizeDesktop(
  value: unknown,
  receivedAt: number,
): Promise<{ activity: DesktopActivity | null; iconAvailable: boolean }> {
  const row = object(value);
  if (!row) return { activity: null, iconAvailable: true };
  const applicationName = text(row.application_name);
  if (!applicationName) throw new Error("desktop 模块缺少 application_name");
  const bundleIdentifier = text(row.bundle_identifier);
  const iconHash = text(row.icon_hash);
  if (iconHash != null && !/^[a-f0-9]{64}$/.test(iconHash)) {
    throw new Error("desktop.icon_hash 必须是 SHA-256 十六进制字符串");
  }

  if (row.icon_data != null) {
    if (!iconHash || typeof row.icon_data !== "string") {
      throw new Error("desktop.icon_data 必须和 icon_hash 一起上传");
    }
    const iconData = Buffer.from(row.icon_data, "base64");
    const actualHash = createHash("sha256").update(iconData).digest("hex");
    if (actualHash !== iconHash) throw new Error("desktop 图标内容与 icon_hash 不一致");
    const uploadedIcon = await storeImageBuffer(
      iconData,
      ICON_MAX_DIMENSION,
      ICON_WEBP_QUALITY,
    );
    if (!uploadedIcon) throw new Error("desktop.icon_data 不是有效图片");
    rememberDesktopIcon(iconHash, uploadedIcon);
  }

  const iconUrl = iconHash ? (telemetryState.desktopIconAssets.get(iconHash) ?? null) : null;
  if (iconHash && iconUrl) rememberDesktopIcon(iconHash, iconUrl);
  return {
    activity: {
      applicationName,
      bundleIdentifier,
      iconUrl,
      observedAt: milliseconds(row.observed_at, receivedAt),
    },
    iconAvailable: iconHash == null || iconUrl != null,
  };
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
    secondsFromGMT: Math.trunc(number(row.seconds_from_gmt) ?? 0),
    observedAt: milliseconds(row.observed_at, receivedAt),
  };
}

async function normalizeMusic(
  value: unknown,
  receivedAt: number,
): Promise<LocalNowPlaying | null> {
  const row = object(value);
  if (!row) return null;
  const rawState = text(row.state);
  const state = rawState === "playing" || rawState === "paused" ? rawState : "stopped";
  const trackId = text(row.track_id);
  return {
    source: "apple-music",
    state,
    title: text(row.title),
    artist: text(row.artist),
    album: text(row.album),
    trackId,
    // 采集端不再上传封面二进制：读取时会查一次 Apple Music 目录拿曲目链接，
    // 那次查询的结果自带封面 URL，见 getMusicPayload
    artworkUrl: null,
    positionMs: Math.max(0, number(row.position_ms) ?? 0),
    durationMs: Math.max(0, number(row.duration_ms) ?? 0),
    // 上报器发的是布尔值，字符串那支是给旧版采集器留的；缺字段按「不循环」处理
    repeatOne: text(row.repeat_one) === "true" || row.repeat_one === true,
    observedAt: milliseconds(row.observed_at, receivedAt),
  };
}

/**
 * 上报器每次露面时的共同记账：谁在采、什么时候来的、有没有声明离线。
 *
 * 数据上报和 presence 心跳都要做这一整套 —— 「上报器还活着」只有一个事实，
 * 不该因为它从哪个路由进来而分成两份实现。从前两边各写了一遍，连顺序都是
 * 随手排的（一个先 declare 后 mark，一个反过来）。
 *
 * 顺序里只有一处是必须的：activeModules 要先落，下面判断充电头在不在采时
 * 读的就是它。
 *
 * 返回在离线声明有没有翻转。持久化和往 SSE 推都不在这里 —— 两条路各有各的
 * 时机（presence 立刻推，envelope 要等模块都处理完一起推），留给调用方。
 */
async function recordReporterBeat({
  offline,
  activeModules,
  receivedAt,
}: {
  offline: boolean;
  /** 缺省表示这次没带，沿用上一次的 —— presence 心跳允许不带 */
  activeModules?: string[];
  receivedAt: number;
}) {
  if (activeModules) telemetryState.activeModules = new Set(activeModules);
  markReporterSeen(receivedAt);
  const flipped = declareReporterOffline(offline);
  // 充电头按「多久没收到推送」判断断流，心跳也得给它续上
  if (telemetryState.activeModules.has("charger")) {
    await recordPushHeartbeat(receivedAt);
  }
  return flipped;
}

/** 一个 envelope 可以只更新一个模块；未出现的模块保持原快照。 */
export async function recordTelemetryEnvelope(input: unknown, receivedAt = Date.now()) {
  await syncTelemetryState();
  const envelope = object(input) as TelemetryEnvelope | null;
  if (!envelope || envelope.version !== 3) throw new Error("遥测协议 version 必须为 3");
  if (number(envelope.heartbeat_at) == null) throw new Error("遥测请求缺少 heartbeat_at");
  if (!Array.isArray(envelope.active_modules)) throw new Error("遥测请求缺少 active_modules");
  const nextActiveModules = envelope.active_modules.filter(
    (value): value is string => typeof value === "string",
  );
  if (nextActiveModules.length !== envelope.active_modules.length) {
    throw new Error("active_modules 只能包含字符串");
  }
  const presence = text(envelope.presence);
  if (presence !== "online" && presence !== "offline") {
    throw new Error("遥测请求的 presence 必须是 online 或 offline");
  }
  /**
   * envelope.presence 是上报器声明的在离线。
   *
   * 只覆盖优雅离开：退出、睡眠时它抢在断开前发一条 offline，这里立刻把状态
   * 翻过去，不用等 45 秒心跳窗口。崩溃、断网、强制关机时它发不出这一条，
   * 那些仍然靠下面 reporterStale 的超时兜底 —— 两条路是互补的。
   *
   * 数据包本身也算一次在线心跳；offline 只用于睡眠、退出这类优雅离开。
   */
  const presenceFlipped = await recordReporterBeat({
    offline: presence === "offline",
    activeModules: nextActiveModules,
    receivedAt,
  });
  const modules = object(envelope.modules);
  if (!modules) throw new Error("遥测请求缺少 modules 对象");

  let accepted = 0;
  let desktopIconAvailable: boolean | undefined;

  if ("charger" in modules) {
    const raw = object(modules.charger) as RawStatus | null;
    if (!raw?.updated_at) throw new Error("charger 模块缺少 updated_at");
    const structuralChanged = await recordStatus(normalizeRawStatus(raw), receivedAt);
    // 插拔、换设备立刻推给浏览器，不等卡片下一次轮询。滚动读数不走这里。
    // since 给当下时刻：历史点一个都不带，客户端沿用自己那份，见 live-events 的说明。
    if (structuralChanged) {
      publish({ type: "charger", payload: await getChargerPayload({ since: Date.now() }) });
    }
    accepted += 1;
  }

  if ("desktop" in modules) {
    const normalized = await normalizeDesktop(modules.desktop, receivedAt);
    desktopIconAvailable = normalized.iconAvailable;
    // 图标引用失效时先让采集端补传，避免向浏览器发布一个短暂的无图中间状态。
    if (desktopIconAvailable) {
      telemetryState.desktop = normalized.activity;
      telemetryState.activityReceivedAt = receivedAt;
      accepted += 1;
    }
  }

  if ("timezone" in modules) {
    telemetryState.timezone = normalizeTimezone(modules.timezone, receivedAt);
    telemetryState.timezoneReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("apple_music" in modules) {
    telemetryState.music = await normalizeMusic(modules.apple_music, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("vibe_coding" in modules) {
    await recordVibeCodingReport(modules.vibe_coding, receivedAt);
    accepted += 1;
  }

  await persistTelemetryState();

  /**
   * 只在模块真的来了才推。
   *
   * 采集端本来就只在内容变化时才带上对应模块，所以「模块出现在 envelope 里」
   * 就是变化信号本身。从前这里是无条件推 —— 连不带任何模块的纯心跳包也推，
   * 为的是把「上报器离线」翻回在线。但 stale 是时间的函数，两张卡一直在轮询，
   * 那件事轮询本来就在做；为它每 30 秒广播一份没变化的状态，等于把 SSE 当轮询用。
   *
   * 代价是上报器从离线恢复时，「在线」最迟等下一轮轮询（连着 SSE 时 30 秒）才
   * 显示，不再是收到心跳的那一刻。换来的是 SSE 上只跑真正的状态变化。
   */
  // 在离线翻转本身就是状态变化，值得推 —— 这正是「关键事件」，不是定时广播
  if (presenceFlipped) await publishPresence();
  if ("desktop" in modules && desktopIconAvailable) await publishDesktop();
  if ("apple_music" in modules) await publishMusic();

  return { accepted, heartbeat: true, desktopIconAvailable };
}

/**
 * 上报器的存活声明，来自专用的 presence 端点。
 *
 * 和数据上报共用同一个 telemetryReceivedAt —— 「上报器还活着」只有一个事实，
 * 不该因为它是从哪个路由进来的而分成两份。数据包本身也算存活证明，所以
 * recordTelemetryEnvelope 里照样刷新那个时间戳。
 */
export async function recordPresence(
  state: "online" | "offline",
  activeModules?: string[],
  receivedAt = Date.now(),
) {
  await syncTelemetryState();
  const flipped = await recordReporterBeat({
    offline: state === "offline",
    activeModules,
    receivedAt,
  });
  await persistTelemetryState();
  // 只有翻转才是事件；周期心跳不该占用推送通道
  if (flipped) await publishPresence();
}

/** 上报器整体是否已超过心跳窗口。只影响 Mac 来的东西，HomePod 走自己的路径。 */
function reporterStale() {
  return reporterOffline();
}

export async function getDesktopPayload(): Promise<DesktopPayload> {
  await syncTelemetryState();
  const stale = !telemetryState.activeModules.has("desktop") || reporterStale();
  return {
    desktop: stale ? null : telemetryState.desktop,
    receivedAt:
      telemetryState.activityReceivedAt || reporterLastSeenAt() || null,
    stale,
  };
}

export async function getTimezonePayload(): Promise<TimezonePayload> {
  await syncTelemetryState();
  const stale = !telemetryState.activeModules.has("timezone") || reporterStale();
  return {
    timezone: stale ? null : telemetryState.timezone,
    receivedAt:
      telemetryState.timezoneReceivedAt || reporterLastSeenAt() || null,
    stale,
  };
}

export async function getMusicPayload(): Promise<MusicPayload> {
  await syncTelemetryState();
  const telemetryStale = reporterStale();
  const musicEnabled = telemetryState.activeModules.has("apple_music");
  const macMusic = musicEnabled && !telemetryStale ? telemetryState.music : null;
  const homePod = await getHomePodNowPlaying();
  const homePodMusic = homePod?.music ?? null;
  const now = Date.now();
  const macPausedFresh =
    macMusic?.state === "paused" &&
    now - macMusic.observedAt < MUSIC_PAUSE_GRACE_MS;
  const homePodPausedFresh =
    homePodMusic?.state === "paused" &&
    now - homePodMusic.observedAt < MUSIC_PAUSE_GRACE_MS;
  const music =
    (macMusic?.state === "playing" ? macMusic : null) ??
    (macPausedFresh ? macMusic : null) ??
    (homePodMusic?.state === "playing" ? homePodMusic : null) ??
    (homePodPausedFresh ? homePodMusic : null);
  // 命中会长期缓存，绝大多数调用不会真的打上游
  const lookup = music ? await resolveTrackLookup(music) : null;
  const link = lookup?.link ?? null;

  return {
    /**
     * 封面优先用目录查出来的那张。
     *
     * 这次查询本来就要做（为了拿链接），结果本来就带 artwork，等于白拿；
     * 而采集端为此要把 JPEG 二进制压进每个换歌的上报包里，是那个模块最大的一块。
     * 目录里没有的曲子（本地导入、非目录内容）查不到封面，那时仍退回采集端送来的那张。
     */
    music: music && lookup?.artwork ? { ...music, artworkUrl: lookup.artwork } : music,
    receivedAt: Math.max(
      telemetryState.activityReceivedAt || reporterLastSeenAt() || 0,
      homePod?.receivedAt ?? 0,
    ) || null,
    // 没东西可显示，而不是「数据过期」—— 没在听歌时这就是常态
    idle: !music,
    id: lookup?.id ?? null,
    link,
  };
}

/**
 * 上报器上下线。只发信号不带数据，让各卡片自己重取 —— 存活影响的是四张卡的
 * stale，逐一算好推出去不如让它们各取各的，省一次全量计算。
 *
 * vibe coding 那张刻意不订阅：token 用量是累计的历史事实，Mac 掉线它不会变得
 * 不可信，只是不再增长。那张卡的陈旧判定另有自己的口径。
 */
export async function publishPresence() {
  publish({ type: "presence", payload: null });
}

export async function publishDesktop() {
  publish({ type: "desktop", payload: await getDesktopPayload() });
}

/**
 * 推送当前播放，并在暂停宽限期结束时精确重算一次来源。
 * 这样前端会直接从暂停来源切到下一实时来源，不会中途闪回 Apple Music 的历史 hero。
 */
export async function publishMusic() {
  const payload = await getMusicPayload();
  publish({ type: "music", payload });

  if (pauseExpiryTimer) {
    clearTimeout(pauseExpiryTimer);
    pauseExpiryTimer = null;
  }
  if (payload.music?.state === "paused") {
    const remaining =
      MUSIC_PAUSE_GRACE_MS - Math.max(0, Date.now() - payload.music.observedAt);
    pauseExpiryTimer = setTimeout(() => {
      pauseExpiryTimer = null;
      void publishMusic();
    }, Math.max(1, remaining + 25));
  }

  return payload;
}

/** 唯一遥测入口的鉴权；未配置密钥时保留本地开发的零配置体验。 */
export function telemetryAuthorized(request: Request) {
  const expected = process.env.TELEMETRY_INGEST_SECRET;
  if (!expected) return true;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}
