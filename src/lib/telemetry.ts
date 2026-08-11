import { timingSafeEqual } from "node:crypto";

import { getChargerPayload, normalizeRawStatus, type RawStatus } from "@/lib/anker";
import { recordPushHeartbeat, recordStatus } from "@/lib/charger-store";
import { resolveTrackLookup } from "@/lib/apple-music";
import { putAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { getHomePodNowPlaying } from "@/lib/homepod-store";
import { ASSET_URL_PREFIX, hasStoredImage, IMAGE_OBJECT_KEY } from "@/lib/r2-assets";
import { number, object, text } from "@/lib/json";
import { publish } from "@/lib/live-events";
import { mirrorKey } from "@/lib/redis";
import {
  offlineByLiveness,
  readLiveness,
  recordReporterBeat,
  type Liveness,
} from "@/lib/reporter-liveness";
import type {
  DesktopActivity,
  DesktopPayload,
  LocalNowPlaying,
  NowListeningPayload,
  TimezoneActivity,
  TimezonePayload,
} from "@/lib/types";
import { recordVibeCodingReport } from "@/lib/vibecoding";

/** 与采集端一致；缓存的是很短的内容哈希 URL，64 项也足够覆盖日常应用。 */
const DESKTOP_ICON_CACHE_LIMIT = 64;

/** 暂停超过 10 秒就不再占用音乐 Hero，让下一个实时来源接管。 */
const MUSIC_PAUSE_GRACE_MS = 10_000;
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
 * 存活不在这份里：它自己占一个 key，见 lib/reporter-liveness。从前它搭这趟车
 * 持久化，于是同一件事有两个写入点，还得靠 restoreLiveness 把进程内存灌回去。
 */
type PersistedTelemetry = {
  desktop: DesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  /** 只给下面的 stampOf 用：这份快照对应的那条信封是什么时候收到的 */
  telemetryReceivedAt: number;
  activeModules: string[];
};

const mirror = mirrorKey<PersistedTelemetry>(
  ["telemetry", "state"],
  // 「有多新」看最后一次收到上报的时刻：每次心跳都会推进它
  (state) => state.telemetryReceivedAt,
);

async function persistTelemetryState(receivedAt: number) {
  await mirror.put({
    desktop: telemetryState.desktop,
    desktopIconAssets: [...telemetryState.desktopIconAssets],
    timezone: telemetryState.timezone,
    music: telemetryState.music,
    activityReceivedAt: telemetryState.activityReceivedAt,
    timezoneReceivedAt: telemetryState.timezoneReceivedAt,
    telemetryReceivedAt: receivedAt,
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
}

type TelemetryEnvelope = {
  presence?: unknown;
  version?: unknown;
  heartbeatAt?: unknown;
  activeModules?: unknown;
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
  const applicationName = text(row.applicationName);
  if (!applicationName) throw new Error("desktop 模块缺少 applicationName");
  const bundleIdentifier = text(row.bundleIdentifier);
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

  // 上报器一次性编好小图并直传 R2，只把对象键发回来。
  // URL 由服务端的 R2_PUBLIC_BASE_URL 组出，避免客户端自己伪造任意展示地址。
  if (iconObjectKey && iconHash && process.env.R2_PUBLIC_BASE_URL) {
    if (await hasStoredImage(iconObjectKey)) {
      rememberDesktopIcon(iconHash, `${ASSET_URL_PREFIX}${iconObjectKey}`);
    } else {
      // 对象不在了（比如桶被清空）：忘掉旧地址，否则下面会拿着它继续发 404
      telemetryState.desktopIconAssets.delete(iconHash);
    }
  }

  const iconUrl = iconHash ? (telemetryState.desktopIconAssets.get(iconHash) ?? null) : null;
  if (iconHash && iconUrl) rememberDesktopIcon(iconHash, iconUrl);
  return {
    activity: {
      applicationName,
      bundleIdentifier,
      iconUrl,
      observedAt: milliseconds(row.observedAt, receivedAt),
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
    secondsFromGMT: Math.trunc(number(row.secondsFromGMT) ?? 0),
    observedAt: milliseconds(row.observedAt, receivedAt),
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
  await syncTelemetryState();
  const envelope = object(input) as TelemetryEnvelope | null;
  if (!envelope || envelope.version !== 4) throw new Error("遥测协议 version 必须为 4");
  if (number(envelope.heartbeatAt) == null) throw new Error("遥测请求缺少 heartbeatAt");
  if (!Array.isArray(envelope.activeModules)) throw new Error("遥测请求缺少 activeModules");
  const nextActiveModules = envelope.activeModules.filter(
    (value): value is string => typeof value === "string",
  );
  if (nextActiveModules.length !== envelope.activeModules.length) {
    throw new Error("activeModules 只能包含字符串");
  }
  const presence = text(envelope.presence);
  if (presence !== "online" && presence !== "offline") {
    throw new Error("遥测请求的 presence 必须是 online 或 offline");
  }
  // 先落 activeModules：下面判断充电头在不在采时读的就是它
  telemetryState.activeModules = new Set(nextActiveModules);
  /**
   * envelope.presence 是上报器声明的在离线。
   *
   * 只覆盖优雅离开：退出、睡眠时它抢在断开前发一条 offline，这里立刻把状态
   * 翻过去，不用等 45 秒心跳窗口。崩溃、断网、强制关机时它发不出这一条，
   * 那些仍然靠 offlineByLiveness 里的心跳窗口兜底 —— 两条路是互补的。
   *
   * 任何一条信封本身都算一次在线心跳；offline 只用于睡眠、退出这类优雅离开。
   */
  const { flipped: presenceFlipped } = await recordReporterBeat({
    offline: presence === "offline",
    at: receivedAt,
  });
  // 充电头按「多久没收到推送」判断断流，纯心跳也得给它续上
  if (telemetryState.activeModules.has("charger")) {
    await recordPushHeartbeat(receivedAt);
  }
  /**
   * modules 省略或为空 = 纯心跳。
   *
   * 只有「给了但不是对象」才算写坏 —— 那是上报器组包出了错，不能默默当成心跳
   * 收下，否则真实的模块数据丢了也没人知道。
   */
  if (envelope.modules != null && !object(envelope.modules)) {
    throw new Error("遥测请求的 modules 必须是对象");
  }
  const modules = object(envelope.modules) ?? {};

  let accepted = 0;
  let desktopIconAvailable: boolean | undefined;

  if ("charger" in modules) {
    const raw = object(modules.charger) as RawStatus | null;
    if (!raw?.updatedAt) throw new Error("charger 模块缺少 updatedAt");
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

  if ("appleMusic" in modules) {
    telemetryState.music = await normalizeMusic(modules.appleMusic, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("appleMusicCredentials" in modules) {
    const row = object(modules.appleMusicCredentials);
    if (!row) throw new Error("appleMusicCredentials 必须是对象");
    const hasMusicUserToken = "musicUserToken" in row;
    const hasDeveloperToken = "developerToken" in row;
    if (!hasMusicUserToken && !hasDeveloperToken) {
      throw new Error("appleMusicCredentials 至少包含一个 token");
    }

    const musicUserToken = hasMusicUserToken ? text(row.musicUserToken) : undefined;
    const developerToken = hasDeveloperToken ? text(row.developerToken) : undefined;
    if (hasMusicUserToken && !musicUserToken) throw new Error("musicUserToken 不能为空");
    if (hasDeveloperToken && !developerToken) throw new Error("developerToken 不能为空");

    const expiresAt = hasDeveloperToken ? number(row.expiresAt) : undefined;
    if (hasDeveloperToken && (expiresAt == null || !Number.isFinite(expiresAt) || expiresAt <= 0)) {
      throw new Error("developerToken 必须带有效的 expiresAt");
    }
    await putAppleMusicCredentials({
      // 上面几道守卫已经保证「带了这个字段就一定非空」，但 text() 的返回类型是
      // string | null，TS 收窄不到这一步，只能把 null 折成 undefined
      musicUserToken: musicUserToken ?? undefined,
      developerToken: developerToken ?? undefined,
      expiresAt: expiresAt ?? undefined,
      receivedAt,
    });
    accepted += 1;
  }

  if ("vibeCoding" in modules) {
    await recordVibeCodingReport(modules.vibeCoding, receivedAt);
    accepted += 1;
  }

  await persistTelemetryState(receivedAt);

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
  if ("appleMusic" in modules) await publishListening();

  return { accepted, heartbeat: true, desktopIconAvailable };
}

/**
 * 取数路径上先把状态和存活各读一次。
 *
 * 存活是另一个 Redis key，两者都要，所以一起读 —— 各自 await 一次的话同一个
 * 请求里会多一趟往返。「上报器整体是否已超过心跳窗口」只影响 Mac 来的东西，
 * HomePod 走自己的路径。
 */
async function syncForRead(): Promise<Liveness> {
  const [, liveness] = await Promise.all([syncTelemetryState(), readLiveness()]);
  return liveness;
}

export async function getDesktopPayload(): Promise<DesktopPayload> {
  const liveness = await syncForRead();
  const stale = !telemetryState.activeModules.has("desktop") || offlineByLiveness(liveness);
  return {
    desktop: stale ? null : telemetryState.desktop,
    receivedAt:
      telemetryState.activityReceivedAt || liveness.lastSeenAt || null,
    stale,
  };
}

export async function getTimezonePayload(): Promise<TimezonePayload> {
  const liveness = await syncForRead();
  const stale = !telemetryState.activeModules.has("timezone") || offlineByLiveness(liveness);
  return {
    timezone: stale ? null : telemetryState.timezone,
    receivedAt:
      telemetryState.timezoneReceivedAt || liveness.lastSeenAt || null,
    stale,
  };
}

export async function getNowListening(): Promise<NowListeningPayload> {
  const liveness = await syncForRead();
  const telemetryStale = offlineByLiveness(liveness);
  const musicEnabled = telemetryState.activeModules.has("appleMusic");
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
      telemetryState.activityReceivedAt || liveness.lastSeenAt || 0,
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
export async function publishListening() {
  const payload = await getNowListening();
  publish({ type: "listening", payload });

  if (pauseExpiryTimer) {
    clearTimeout(pauseExpiryTimer);
    pauseExpiryTimer = null;
  }
  if (payload.music?.state === "paused") {
    const remaining =
      MUSIC_PAUSE_GRACE_MS - Math.max(0, Date.now() - payload.music.observedAt);
    pauseExpiryTimer = setTimeout(() => {
      pauseExpiryTimer = null;
      void publishListening();
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
