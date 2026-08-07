import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeRawStatus, type RawStatus } from "@/lib/anker";
import { recordPushHeartbeat, recordStatus } from "@/lib/charger-store";
import { resolveTrackLink } from "@/lib/apple-music";
import { getHomePodNowPlaying } from "@/lib/homepod-store";
import { storeUploadedImage } from "@/lib/image-store";
import { number, object, text } from "@/lib/json";
import { ASSET_URL_PREFIX } from "@/lib/image-store";
import { publish } from "@/lib/live-events";
import type {
  DesktopActivity,
  DesktopPayload,
  LocalNowPlaying,
  MusicPayload,
} from "@/lib/types";
import { recordVibeCodingReport } from "@/lib/vibecoding";

// The sender heartbeats every 30s; leave room for timer and network jitter.
const ACTIVITY_STALE_MS = 45_000;
/** 暂停超过这个时间就不再占用音乐 Hero，让下一个实时来源接管。 */
const MUSIC_PAUSE_GRACE_MS = 30_000;
let pauseExpiryTimer: ReturnType<typeof setTimeout> | null = null;

type TelemetryState = {
  desktop: DesktopActivity | null;
  music: LocalNowPlaying | null;
  activityReceivedAt: number;
  telemetryReceivedAt: number;
  activeModules: Set<string>;
};

const globalTelemetry = globalThis as typeof globalThis & {
  __lyjwTelemetryState?: TelemetryState;
};
const telemetryState = (globalTelemetry.__lyjwTelemetryState ??= {
  desktop: null,
  music: null,
  activityReceivedAt: 0,
  telemetryReceivedAt: 0,
  activeModules: new Set<string>(),
});
const TELEMETRY_CACHE_DIR = join(tmpdir(), "lyjwpage-telemetry-v2");
const TELEMETRY_STATE_FILE = join(TELEMETRY_CACHE_DIR, "activity.json");
let telemetryHydrated = false;

function persistTelemetryState() {
  mkdirSync(TELEMETRY_CACHE_DIR, { recursive: true });
  const temporaryFile = `${TELEMETRY_STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(
    temporaryFile,
    JSON.stringify({
      desktop: telemetryState.desktop,
      music: telemetryState.music,
      activityReceivedAt: telemetryState.activityReceivedAt,
      telemetryReceivedAt: telemetryState.telemetryReceivedAt,
      activeModules: [...telemetryState.activeModules],
    }),
  );
  renameSync(temporaryFile, TELEMETRY_STATE_FILE);
}

function keepFreshAsset<T, K extends keyof T>(row: T | null, field: K): T | null {
  if (!row) return null;
  const url = row[field];
  if (typeof url === "string" && !url.startsWith(ASSET_URL_PREFIX)) {
    return { ...row, [field]: null };
  }
  return row;
}

function hydrateTelemetryState() {
  if (telemetryHydrated) return;
  telemetryHydrated = true;
  try {
    const cached = JSON.parse(readFileSync(TELEMETRY_STATE_FILE, "utf8")) as {
      desktop?: DesktopActivity | null;
      music?: LocalNowPlaying | null;
      activityReceivedAt?: number;
      telemetryReceivedAt?: number;
      activeModules?: string[];
    };
    /**
     * 丢掉不是当前格式的图片 URL。
     *
     * 这些 URL 跟着状态一起持久化，而存图的路由改过前缀 —— 存量的旧 URL 会
     * 一直指向已经删掉的路由、稳定 404，且只有等设备重新上报同一张图才会
     * 被覆盖（换歌 / 换应用才会重发）。宁可先不显示，也别挂一张裂图。
     */
    telemetryState.desktop = keepFreshAsset(cached.desktop ?? null, "iconUrl");
    telemetryState.music = keepFreshAsset(cached.music ?? null, "artworkUrl");
    telemetryState.activityReceivedAt = cached.activityReceivedAt ?? 0;
    telemetryState.telemetryReceivedAt = cached.telemetryReceivedAt ?? 0;
    telemetryState.activeModules = new Set(cached.activeModules ?? []);
  } catch {
    // 首次启动时没有缓存文件是正常情况。
  }
}

type TelemetryEnvelope = {
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

async function normalizeDesktop(
  value: unknown,
  receivedAt: number,
): Promise<DesktopActivity | null> {
  const row = object(value);
  if (!row) return null;
  const applicationName = text(row.application_name);
  if (!applicationName) return null;
  const bundleIdentifier = text(row.bundle_identifier);
  const previousIcon =
    telemetryState.desktop?.bundleIdentifier === bundleIdentifier
      ? telemetryState.desktop.iconUrl
      : null;
  return {
    applicationName,
    bundleIdentifier,
    iconUrl: (await storeUploadedImage(row.icon_data)) ?? previousIcon,
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
  const previousArtwork =
    telemetryState.music?.trackId === trackId ? telemetryState.music.artworkUrl : null;
  return {
    source: "apple-music",
    state,
    title: text(row.title),
    artist: text(row.artist),
    album: text(row.album),
    trackId,
    artworkUrl: (await storeUploadedImage(row.artwork_data)) ?? previousArtwork,
    positionMs: Math.max(0, number(row.position_ms) ?? 0),
    durationMs: Math.max(0, number(row.duration_ms) ?? 0),
    // 上报器目前不上报循环状态，缺字段时按「不循环」处理
    repeatOne: text(row.repeat_one) === "true" || row.repeat_one === true,
    observedAt: milliseconds(row.observed_at, receivedAt),
  };
}

/** 一个 envelope 可以只更新一个模块；未出现的模块保持原快照。 */
export async function recordTelemetryEnvelope(input: unknown, receivedAt = Date.now()) {
  hydrateTelemetryState();
  const envelope = object(input) as TelemetryEnvelope | null;
  if (!envelope || envelope.version !== 2) throw new Error("遥测协议 version 必须为 2");
  if (number(envelope.heartbeat_at) == null) throw new Error("遥测请求缺少 heartbeat_at");
  if (!Array.isArray(envelope.active_modules)) throw new Error("遥测请求缺少 active_modules");
  const nextActiveModules = envelope.active_modules.filter(
    (value): value is string => typeof value === "string",
  );
  if (nextActiveModules.length !== envelope.active_modules.length) {
    throw new Error("active_modules 只能包含字符串");
  }
  telemetryState.activeModules = new Set(nextActiveModules);
  telemetryState.telemetryReceivedAt = receivedAt;
  if (telemetryState.activeModules.has("charger")) {
    await recordPushHeartbeat(receivedAt);
  }
  const modules = object(envelope.modules);
  if (!modules) throw new Error("遥测请求缺少 modules 对象");

  let accepted = 0;

  if ("charger" in modules) {
    const raw = object(modules.charger) as RawStatus | null;
    if (!raw?.updated_at) throw new Error("charger 模块缺少 updated_at");
    await recordStatus(normalizeRawStatus(raw), receivedAt);
    accepted += 1;
  }

  if ("desktop" in modules) {
    telemetryState.desktop = await normalizeDesktop(modules.desktop, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("apple_music" in modules) {
    telemetryState.music = await normalizeMusic(modules.apple_music, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("vibe_coding" in modules) {
    recordVibeCodingReport(modules.vibe_coding, receivedAt);
    accepted += 1;
  }

  persistTelemetryState();

  // 心跳包也要推：它不带模块数据，但会刷新 receivedAt，
  // 前端据此把「上报器离线」翻回在线。两边的 stale/idle 都是时间的函数，
  // 所以两个都推。
  publishDesktop();
  await publishMusic();

  return { accepted, heartbeat: true };
}

/** 上报器整体是否已超过心跳窗口。只影响 Mac 来的东西，HomePod 走自己的路径。 */
function reporterStale() {
  return (
    !telemetryState.telemetryReceivedAt ||
    Date.now() - telemetryState.telemetryReceivedAt > ACTIVITY_STALE_MS
  );
}

export function getDesktopPayload(): DesktopPayload {
  hydrateTelemetryState();
  const stale = !telemetryState.activeModules.has("desktop") || reporterStale();
  return {
    desktop: stale ? null : telemetryState.desktop,
    receivedAt:
      telemetryState.activityReceivedAt || telemetryState.telemetryReceivedAt || null,
    stale,
  };
}

export async function getMusicPayload(): Promise<MusicPayload> {
  hydrateTelemetryState();
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
  const link = music ? await resolveTrackLink(music) : null;

  return {
    music,
    receivedAt: Math.max(
      telemetryState.activityReceivedAt || telemetryState.telemetryReceivedAt || 0,
      homePod?.receivedAt ?? 0,
    ) || null,
    // 没东西可显示，而不是「数据过期」—— 没在听歌时这就是常态
    idle: !music,
    link,
  };
}

export function publishDesktop() {
  publish({ type: "desktop", payload: getDesktopPayload() });
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
