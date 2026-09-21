import { requestState } from "@shared/request-state";
import { resolveTrackLookup } from "@/lib/apple-music";
import {
  type StoredHomePod
} from "@/lib/homepod-store";
import { type NowListeningCandidate, type NowListeningSnapshot } from "@/lib/now-listening";
import {
  type PlayingQueueTrack
} from "@/lib/playing-queue";
import { IMAGE_OBJECT_KEY, publicAssetPath } from "@/lib/asset-url";
import { fieldMirror } from "@/lib/storage";
import { withPresence, type Liveness } from "@/lib/reporter-liveness";
import type {
  DesktopActivity,
  DesktopPayload,
  LocalNowPlaying,
  TimezoneActivity
} from "@/lib/types";

/** 与采集端一致；缓存的是很短的内容对象键，64 项也足够覆盖日常应用。 */
export const DESKTOP_ICON_CACHE_LIMIT = 64;

export type StoredDesktopActivity = Omit<DesktopActivity, "iconUrl"> & {
  iconObjectKey: string | null;
};

export type TelemetryState = {
  desktop: StoredDesktopActivity | null;
  /** iconHash → objectKey；公开 URL 到读取/推送响应时才按当前部署拼 */
  desktopIconAssets: Map<string, string>;
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  /** 当前曲后面两首，只用来搜目录 ID，不进浏览器 */
  upcomingTracks: PlayingQueueTrack[];
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  activeModules: Set<string>;
};

function state(): TelemetryState {
  return requestState("telemetry", () => ({ desktop: null, desktopIconAssets: new Map(), timezone: null,
    music: null, upcomingTracks: [], activityReceivedAt: 0, timezoneReceivedAt: 0, activeModules: new Set<string>() }));
}
export const telemetryState = new Proxy({} as TelemetryState, {
  get(_target, property) { return Reflect.get(state(), property); },
  set(_target, property, value) { return Reflect.set(state(), property, value); },
});

/**
 * 遥测状态的持久化。
 *
 * 从前写的是临时文件（$TMPDIR/lyjwpage-telemetry-v2/activity.json），全站只有
 * 这一处这么干 —— 于是清空 SQLite 对它毫无作用，连重启 dev server 都清不掉，
 * 排查冷启动时会以为清干净了其实没有。现在和别的 store 一样落 SQLite，
 * 正在播等模块按字段 HSET，心跳不会把整包盖回去。规则见 lib/storage 的 fieldMirror。
 *
 * 存活不在这份里：它自己占一个 key，见 lib/reporter-liveness。从前它搭这趟车
 * 持久化，于是同一件事有两个写入点，还得靠 restoreLiveness 把进程内存灌回去。
 */
export type PersistedTelemetry = {
  desktop: StoredDesktopActivity | null;
  desktopIconAssets?: [string, string][];
  timezone: TimezoneActivity | null;
  music: LocalNowPlaying | null;
  upcomingTracks?: PlayingQueueTrack[];
  activityReceivedAt: number;
  timezoneReceivedAt: number;
  /** 只给下面的 stampOf 用：这份快照对应的那条信封是什么时候收到的 */
  telemetryReceivedAt: number;
  activeModules: string[];
};

export const mirror = fieldMirror<PersistedTelemetry>(
  ["telemetry", "fields"],
  // 「有多新」看最后一次收到上报的时刻：每次心跳都会推进它
  (state) => state.telemetryReceivedAt,
);

/**
 * 从持久层同步一次工作副本。每个入口都先调它。
 *
 * 不是「只在启动时 hydrate 一次」—— 那正是这轮要消灭的东西：读一次就再也不问，
 * 等于让进程内存变成第二份真相，清空 SQLite 也翻不动它。fieldMirror 自己会处理
 * 「SQLite 不可达就用内存副本」，所以每次问的代价只是一次 pipeline。
 */
export async function syncTelemetryState() {
  const stored = await mirror.get();
  if (!stored) {
    // 真被清空了（或从没写过），工作副本跟着归零
    telemetryState.desktop = null;
    telemetryState.desktopIconAssets = new Map();
    telemetryState.timezone = null;
    telemetryState.music = null;
    telemetryState.upcomingTracks = [];
    telemetryState.activityReceivedAt = 0;
    telemetryState.timezoneReceivedAt = 0;
    telemetryState.activeModules = new Set();
    return;
  }
  telemetryState.desktop = stored.desktop ?? null;
  telemetryState.desktopIconAssets = new Map(
    (stored.desktopIconAssets ?? [])
      .filter((entry): entry is [string, string] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        IMAGE_OBJECT_KEY.test(entry[1]),
      )
      .slice(-DESKTOP_ICON_CACHE_LIMIT),
  );
  telemetryState.timezone = stored.timezone ?? null;
  telemetryState.music = stored.music ?? null;
  telemetryState.upcomingTracks = stored.upcomingTracks ?? [];
  telemetryState.activityReceivedAt = stored.activityReceivedAt ?? 0;
  telemetryState.timezoneReceivedAt = stored.timezoneReceivedAt ?? 0;
  telemetryState.activeModules = new Set(stored.activeModules ?? []);
}

/**
 * 过了 activeModules 那道闸的前台应用。
 *
 * 模块关掉之后工作副本里还留着最后一次前台应用，但它不再代表此刻 —— 读取、推送
 * 和 pulse 都得走这一份判断，各写各的话总有一处会把早就关掉的窗口继续算在活动里。
 */
export function activeDesktop(): StoredDesktopActivity | null {
  return telemetryState.activeModules.has("desktop") ? telemetryState.desktop : null;
}

/**
 * 拿工作副本现拼一份前台应用。
 *
 * 取数那侧先 syncForRead 再调它；上报那侧直接调 —— 工作副本这时正是这条信封
 * 刚更新好的样子，而存活也是刚算出来的。**上报路径上绝不能再 sync 一次**：
 * 那会拿写之前的 SQLite 把刚更新的工作副本盖回去，而且和还在飞的那次写撞车。
 */
export function desktopPayload(liveness: Liveness): DesktopPayload {
  const stored = activeDesktop();
  const desktop: DesktopActivity | null = stored
    ? {
      applicationName: stored.applicationName,
      bundleIdentifier: stored.bundleIdentifier,
      // 出口这侧兜住「没有标题就是 null」：SQLite 里躺着的那条快照可能是上一次
      // 部署写的，字段整个不在。逐字段拼而不是展开，就是为了这一格有确定的值。
      windowTitle: stored.windowTitle ?? null,
      iconUrl: stored.iconObjectKey ? publicAssetPath(stored.iconObjectKey) : null,
      observedAt: stored.observedAt,
    }
    : null;
  return withPresence(
    {
      desktop,
      receivedAt: telemetryState.activityReceivedAt || liveness.lastSeenAt || null,
    },
    liveness,
  );
}

function playableCandidate(music: LocalNowPlaying | null): music is LocalNowPlaying {
  return Boolean(music && music.state !== "stopped" && music.title);
}

function macSnapshotInput(mac?: {
  music: LocalNowPlaying | null;
  receivedAt: number;
  upcomingTracks?: PlayingQueueTrack[];
}) {
  return (
    mac ?? {
      music: telemetryState.music,
      receivedAt: telemetryState.activityReceivedAt,
      upcomingTracks: telemetryState.upcomingTracks,
    }
  );
}

/** 不查目录的候选：只够仲裁「谁在放、放没放」；链接、封面、歌词位留空。给 pulse 用，不给页面。 */
export function bareCandidate(
  music: LocalNowPlaying | null,
  receivedAt: number,
): NowListeningCandidate | null {
  if (!playableCandidate(music)) return null;
  return {
    music,
    receivedAt,
    id: null,
    link: null,
    songId: null,
    upcomingSongIds: [],
    hasLyrics: false,
  };
}

export async function decorateCandidate(
  music: LocalNowPlaying | null,
  receivedAt: number,
  upcomingTracks: PlayingQueueTrack[] = [],
): Promise<NowListeningCandidate | null> {
  const bare = bareCandidate(music, receivedAt);
  if (!bare) return null;
  const [lookup, ...ahead] = await Promise.all([
    resolveTrackLookup(bare.music),
    ...upcomingTracks.map((track) => resolveTrackLookup(track)),
  ]);
  return {
    /**
     * 封面优先用目录查出来的那张。
     *
     * 这次查询本来就要做（为了拿链接），结果本来就带 artwork，等于白拿；
     * 而采集端为此要把 JPEG 二进制压进每个换歌的上报包里，是那个模块最大的一块。
     * 目录里没有的曲子（本地导入、非目录内容）查不到封面，那时仍退回采集端送来的那张。
     */
    ...bare,
    music: lookup.artwork ? { ...bare.music, artworkUrl: lookup.artwork } : bare.music,
    id: lookup.id,
    link: lookup.link || null,
    songId: lookup.songId,
    upcomingSongIds: ahead.flatMap((hit) => (hit.songId ? [hit.songId] : [])),
    hasLyrics: lookup.hasLyrics,
  };
}

/**
 * 两个候选从 SQLite 读出并查好目录链接。不选 Hero、不看存活。
 *
 * 换歌 / HA 推送才变，所以能进 `'use cache'`。暂停宽限期和 HomePod 静默在
 * pickNowListening 里现算。
 */
/** 工作副本 + 一份 HomePod 快照 → 两个查好链接的候选。谁都不再回 Storage 取 */
export async function snapshotFrom(
  homePodStored: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks?: PlayingQueueTrack[];
  },
): Promise<NowListeningSnapshot> {
  const source = macSnapshotInput(mac);
  const musicEnabled = telemetryState.activeModules.has("appleMusic");
  const [macCandidate, homePod] = await Promise.all([
    musicEnabled
      ? decorateCandidate(source.music, source.receivedAt, source.upcomingTracks ?? telemetryState.upcomingTracks)
      : null,
    homePodStored ? decorateCandidate(homePodStored.music, homePodStored.receivedAt) : null,
  ]);
  return {
    mac: macCandidate,
    homePod,
    macReceivedAt: source.receivedAt,
  };
}

/** 同 snapshotFrom 的仲裁输入，但不查 Apple 目录。pulse 只需要 idle / state / 曲名。 */
export function bareSnapshotFrom(
  homePodStored: StoredHomePod | null,
  mac?: {
    music: LocalNowPlaying | null;
    receivedAt: number;
    upcomingTracks?: PlayingQueueTrack[];
  },
): NowListeningSnapshot {
  const source = macSnapshotInput(mac);
  const musicEnabled = telemetryState.activeModules.has("appleMusic");
  return {
    mac: musicEnabled ? bareCandidate(source.music, source.receivedAt) : null,
    homePod: homePodStored ? bareCandidate(homePodStored.music, homePodStored.receivedAt) : null,
    macReceivedAt: source.receivedAt,
  };
}
