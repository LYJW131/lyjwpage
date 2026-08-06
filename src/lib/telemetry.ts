import { createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeRawStatus, type RawStatus } from "@/lib/anker";
import { recordPushHeartbeat, recordStatus } from "@/lib/charger-store";
import { publish } from "@/lib/live-events";
import type {
  ActivityPayload,
  DesktopActivity,
  LocalNowPlaying,
} from "@/lib/types";
import { recordVibeCodingReport } from "@/lib/vibecoding";

// The sender heartbeats every 30s; leave room for timer and network jitter.
const ACTIVITY_STALE_MS = 45_000;

type ActivityAsset = { body: Uint8Array; contentType: string };
type TelemetryState = {
  desktop: DesktopActivity | null;
  music: LocalNowPlaying | null;
  activityReceivedAt: number;
  telemetryReceivedAt: number;
  activeModules: Set<string>;
  activityAssets: Map<string, ActivityAsset>;
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
  activityAssets: new Map<string, ActivityAsset>(),
});
const MAX_ACTIVITY_ASSET_BYTES = 5 * 1024 * 1024;
const TELEMETRY_CACHE_DIR = join(tmpdir(), "lyjwpage-telemetry-v2");
const TELEMETRY_STATE_FILE = join(TELEMETRY_CACHE_DIR, "activity.json");

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

function hydrateTelemetryState() {
  try {
    const cached = JSON.parse(readFileSync(TELEMETRY_STATE_FILE, "utf8")) as {
      desktop?: DesktopActivity | null;
      music?: LocalNowPlaying | null;
      activityReceivedAt?: number;
      telemetryReceivedAt?: number;
      activeModules?: string[];
    };
    telemetryState.desktop = cached.desktop ?? null;
    telemetryState.music = cached.music ?? null;
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

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function milliseconds(value: unknown, fallback = Date.now()) {
  const parsed = number(value);
  if (parsed == null) return fallback;
  return parsed > 1e12 ? parsed : parsed * 1000;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function storeActivityAsset(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_ACTIVITY_ASSET_BYTES * 2) return null;
  const body = Buffer.from(value, "base64");
  if (!body.length || body.length > MAX_ACTIVITY_ASSET_BYTES) return null;
  const contentType =
    body[0] === 0xff && body[1] === 0xd8
      ? "image/jpeg"
      : body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47
        ? "image/png"
        : null;
  if (!contentType) return null;
  const id = createHash("sha256").update(body).digest("hex").slice(0, 24);
  telemetryState.activityAssets.set(id, { body, contentType });
  mkdirSync(TELEMETRY_CACHE_DIR, { recursive: true });
  writeFileSync(join(TELEMETRY_CACHE_DIR, id), body);
  return `/api/status/activity/assets/${id}`;
}

function normalizeDesktop(value: unknown, receivedAt: number): DesktopActivity | null {
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
    iconUrl: storeActivityAsset(row.icon_data) ?? previousIcon,
    observedAt: milliseconds(row.observed_at, receivedAt),
  };
}

function normalizeMusic(value: unknown, receivedAt: number): LocalNowPlaying | null {
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
    artworkUrl: storeActivityAsset(row.artwork_data) ?? previousArtwork,
    positionMs: Math.max(0, number(row.position_ms) ?? 0),
    durationMs: Math.max(0, number(row.duration_ms) ?? 0),
    observedAt: milliseconds(row.observed_at, receivedAt),
  };
}

export function getActivityAsset(id: string) {
  const memory = telemetryState.activityAssets.get(id);
  if (memory) return memory;
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  try {
    const body = readFileSync(join(TELEMETRY_CACHE_DIR, id));
    const contentType = body[0] === 0xff ? "image/jpeg" : "image/png";
    return { body, contentType };
  } catch {
    return null;
  }
}

/** 一个 envelope 可以只更新一个模块；未出现的模块保持原快照。 */
export async function recordTelemetryEnvelope(input: unknown, receivedAt = Date.now()) {
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
    telemetryState.desktop = normalizeDesktop(modules.desktop, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("apple_music" in modules) {
    telemetryState.music = normalizeMusic(modules.apple_music, receivedAt);
    telemetryState.activityReceivedAt = receivedAt;
    accepted += 1;
  }

  if ("vibe_coding" in modules) {
    recordVibeCodingReport(modules.vibe_coding, receivedAt);
    accepted += 1;
  }

  persistTelemetryState();

  // 心跳包也要推：它不带模块数据，但会刷新 receivedAt，
  // 前端据此把「上报器离线」翻回在线。
  publish({ type: "activity", payload: getActivityPayload() });

  return { accepted, heartbeat: true };
}

export function getActivityPayload(): ActivityPayload {
  hydrateTelemetryState();
  const activityEnabled =
    telemetryState.activeModules.has("desktop") ||
    telemetryState.activeModules.has("apple_music");
  return {
    desktop: telemetryState.activeModules.has("desktop") ? telemetryState.desktop : null,
    music: telemetryState.activeModules.has("apple_music") ? telemetryState.music : null,
    receivedAt:
      telemetryState.activityReceivedAt || telemetryState.telemetryReceivedAt || null,
    stale:
      activityEnabled &&
      (!telemetryState.telemetryReceivedAt ||
        Date.now() - telemetryState.telemetryReceivedAt > ACTIVITY_STALE_MS),
  };
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
