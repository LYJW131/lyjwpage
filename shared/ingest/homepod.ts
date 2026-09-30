import { createHash } from "node:crypto";

import { numberish, object, text } from "@/lib/json";
import type { StoredHomePod } from "@shared/homepod-store";

function observedAt(value: unknown, fallbackAt: number) {
  const parsed = numberish(value);
  if (parsed == null) return fallbackAt;
  return Math.min(parsed, fallbackAt);
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (!mapped) return false;
    return isPrivateHost(mapped[1]);
  }

  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  return !host.includes(".");
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
        ? `https://is1-ssl.mzstatic.com/image/thumb/${cachedArtwork}/600x600bb.webp`
        : null;
    const candidate = (relativeAppleArtwork ?? cachedArtwork ?? raw)
      .replaceAll("{w}", "600")
      .replaceAll("{h}", "600")
      .replaceAll("{f}", "webp");
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (isPrivateHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeHomePodEvent(
  input: unknown,
  receivedAt = Date.now(),
): StoredHomePod {
  const row = object(input);
  if (!row) throw new Error("HomePod 请求必须是 JSON 对象");

  const rawState = text(row.state)?.toLowerCase();
  // buffering 仍属于播放，归为 stopped 会让曲目在短暂缓冲时消失。
  const state =
    rawState === "playing" || rawState === "buffering"
      ? "playing"
      : rawState === "paused"
        ? "paused"
        : "stopped";
  const title = text(row.title);
  const artist = text(row.artist);
  const album = text(row.album);
  const identity = [text(row.entityId), title, artist, album].filter(Boolean).join("\n");

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
      artworkUrl: publicArtwork(row.artworkUrl),
      positionMs: Math.max(0, numberish(row.positionMs) ?? 0),
      durationMs: Math.max(0, numberish(row.durationMs) ?? 0),
      repeatOne: row.repeatOne === true || text(row.repeatOne)?.toLowerCase() === "true",
      observedAt: observedAt(row.observedAt, receivedAt),
    },
    receivedAt,
  };
}

export type PreparedHomePodEvent = { source: "homepod"; stored: StoredHomePod };

export function prepareHomePodEvent(body: unknown, receivedAt = Date.now()): PreparedHomePodEvent {
  return { source: "homepod", stored: normalizeHomePodEvent(body, receivedAt) };
}
