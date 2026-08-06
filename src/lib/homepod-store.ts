import { createHash } from "node:crypto";

import { key, withRedis } from "@/lib/redis";
import type { LocalNowPlaying } from "@/lib/types";

const TTL_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_DURATION_STALE_MS = 12 * 60 * 60 * 1000;
const K_NOW_PLAYING = key("homepod", "nowPlaying");

type StoredHomePod = {
  music: LocalNowPlaying;
  receivedAt: number;
};

let fallback: StoredHomePod | null = null;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestamp(value: unknown, fallbackAt: number) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallbackAt;
  // A bad Home Assistant clock must not make the browser project progress from the future.
  return Math.min(parsed, fallbackAt);
}

function publicArtwork(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const homeAssistantUrl = new URL(raw, "http://home-assistant.invalid");
    const cachedArtwork = homeAssistantUrl.searchParams.get("cache");
    const relativeAppleArtwork =
      cachedArtwork &&
      !cachedArtwork.includes("..") &&
      /^Music\d+\/[A-Za-z0-9_./-]+\.(?:jpe?g|png)$/i.test(cachedArtwork)
        ? `https://is1-ssl.mzstatic.com/image/thumb/${cachedArtwork}/600x600bb.jpg`
        : null;
    const candidate = (relativeAppleArtwork ?? cachedArtwork ?? raw)
      .replaceAll("{w}", "600")
      .replaceAll("{h}", "600")
      .replaceAll("{f}", "jpg");
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      /^(?:10|127|192\.168)\./.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Normalize the Home Assistant rest_command payload into the card's shared contract. */
export function normalizeHomePodEvent(
  input: unknown,
  receivedAt = Date.now(),
): StoredHomePod {
  const row = object(input);
  if (!row) throw new Error("HomePod 请求必须是 JSON 对象");

  const rawState = text(row.state)?.toLowerCase();
  const state = rawState === "playing" || rawState === "paused" ? rawState : "stopped";
  const title = text(row.title);
  const artist = text(row.artist);
  const album = text(row.album);
  const identity = [text(row.entity_id), title, artist, album].filter(Boolean).join("\n");

  return {
    music: {
      source: "homepod",
      state,
      title,
      artist,
      album,
      trackId: identity
        ? createHash("sha256").update(identity).digest("hex").slice(0, 24)
        : null,
      artworkUrl: publicArtwork(row.artwork),
      positionMs: Math.max(0, (number(row.position) ?? 0) * 1000),
      durationMs: Math.max(0, (number(row.duration) ?? 0) * 1000),
      observedAt: timestamp(row.position_updated_at ?? row.updated_at, receivedAt),
    },
    receivedAt,
  };
}

export async function recordHomePodEvent(input: unknown, receivedAt = Date.now()) {
  const stored = normalizeHomePodEvent(input, receivedAt);
  fallback = stored;
  await withRedis(
    async (redis) => redis.set(K_NOW_PLAYING, JSON.stringify(stored), "PX", TTL_MS),
    null,
  );
  return stored;
}

async function readStored(): Promise<StoredHomePod | null> {
  const raw = await withRedis(async (redis) => redis.get(K_NOW_PLAYING), null);
  if (raw) {
    try {
      return JSON.parse(raw) as StoredHomePod;
    } catch {
      // Treat malformed cached state as absent.
    }
  }
  return fallback;
}

export async function getHomePodNowPlaying(now = Date.now()) {
  const stored = await readStored();
  if (!stored || stored.music.state === "stopped" || !stored.music.title) return null;

  const { music } = stored;
  const projectedPosition =
    music.positionMs + (music.state === "playing" ? Math.max(0, now - music.observedAt) : 0);
  if (music.durationMs > 0 && projectedPosition >= music.durationMs) return null;
  if (!music.durationMs && now - stored.receivedAt > UNKNOWN_DURATION_STALE_MS) return null;

  return stored;
}
