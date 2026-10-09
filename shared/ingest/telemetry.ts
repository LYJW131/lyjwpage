import type { TrackEnrichment } from "@/lib/track-enrichment";
import {
  normalizeChargingDevice,
  normalizePowerBank,
  pickCharger,
  pickPowerBank,
  type RawChargingDevices,
} from "@/lib/charging-device";
import { number, object, text } from "@/lib/json";
import {
  normalizePlayingQueue,
  upcomingQueueTracks,
  type PlayingQueueTrack,
} from "@/lib/playing-queue";
import { IMAGE_OBJECT_KEY } from "@/lib/asset-url";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@/lib/types";
import type {
  LocalNowPlaying,
  ReportedChargerStatus,
  ReportedPowerBankStatus,
  TimezoneActivity,
} from "@/lib/types";
import type { StoredDesktopActivity } from "@shared/telemetry";

import { CODING_MODULES, prepareCodingModules, type CodingModuleRejection, type CodingModules } from "./coding";


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

const KNOWN_MODULES = new Set<string>([
  "chargingDevices",
  "desktop",
  "timezone",
  "appleMusic",
  "appleMusicCredentials",
  ...CODING_MODULES,
]);

export type PreparedTelemetryEnvelope = {
  source: "mac";
  receivedAt: number;
  presence: "online" | "offline";
  activeModules: string[];
  ignored: string[];
  rejected: CodingModuleRejection[];
  modules: CodingModules & {
    chargingDevices?: {
      charger: ReportedChargerStatus | null;
      powerBank: ReportedPowerBankStatus | null;
      failureAfterCharger?: string;
    };
    desktop?: PreparedDesktop;
    timezone?: TimezoneActivity | null;
    appleMusic?: { music: LocalNowPlaying | null; upcomingTracks: PlayingQueueTrack[]; enrichment?: TrackEnrichment | null };
    appleMusicCredentials?: { musicUserToken: string };
  };
  // 失败须留到对应提交阶段再抛，不能撤销更早模块已承诺的写入。
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
  // iconHash 标识应用图标，iconObjectKey 标识已上传字节；合并会混淆无图标与待补传。
  const iconObjectKey = text(row.iconObjectKey);
  if (iconObjectKey != null && !IMAGE_OBJECT_KEY.test(iconObjectKey)) {
    throw new Error("desktop.iconObjectKey 必须是 <sha256>.png 或 <sha256>.webp");
  }
  if (iconObjectKey != null && iconHash == null) {
    throw new Error("desktop.iconObjectKey 必须和 iconHash 一起上报");
  }

  if (row.iconData != null) throw new Error("desktop.iconData 已停用，请由上报器直传 R2");

  // 不在前台切换热路径做 R2 HEAD，避免图片存储慢响应拖住整封上报。
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

const WINDOW_TITLE_MAX = 200;

// 隐藏应用时必须同时清空窗口标题，避免从标题泄露被隐藏的活动。
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
    artworkUrl: null,
    positionMs: Math.max(0, number(row.positionMs) ?? 0),
    durationMs: Math.max(0, number(row.durationMs) ?? 0),
    repeatOne: text(row.repeatOne) === "true" || row.repeatOne === true,
    observedAt: milliseconds(row.observedAt, receivedAt),
  };
}


export function parseAppleMusicCredentials(value: unknown): { musicUserToken: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("appleMusicCredentials 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if ("developerToken" in row || "expiresAt" in row) {
    throw new Error("appleMusicCredentials.developerToken 已停用：developer token 由 Worker 自签，只上报 musicUserToken");
  }
  const musicUserToken = typeof row.musicUserToken === "string" ? row.musicUserToken.trim() : "";
  if (!musicUserToken) throw new Error("appleMusicCredentials.musicUserToken 不能为空");
  return { musicUserToken };
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
  const ignored = Object.keys(raw).filter((name) => !KNOWN_MODULES.has(name));
  const coding = prepareCodingModules(raw, receivedAt);
  const rejected = coding.rejected;

  const modules: PreparedTelemetryEnvelope["modules"] = {};
  const fail = (
    stage: NonNullable<PreparedTelemetryEnvelope["failure"]>["stage"],
    error: unknown,
  ): PreparedTelemetryEnvelope => ({
    source: "mac" as const,
    receivedAt,
    presence: normalizedPresence,
    activeModules,
    ignored,
    rejected,
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
        return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, ignored, rejected, modules };
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
  Object.assign(modules, coding.modules);

  return { source: "mac", receivedAt, presence: normalizedPresence, activeModules, ignored, rejected, modules };
}

function upcomingFromMusicRow(row: Record<string, unknown>, title: string | null) {
  return upcomingQueueTracks(normalizePlayingQueue(row.queue), title);
}
