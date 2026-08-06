import { createHash } from "node:crypto";

import { numberish, object, text } from "@/lib/json";
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

function timestamp(value: unknown, fallbackAt: number) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallbackAt;
  // A bad Home Assistant clock must not make the browser project progress from the future.
  return Math.min(parsed, fallbackAt);
}

/**
 * 内网 / 环回地址判定。
 *
 * 这个 URL 会原样发给访客的浏览器去加载，所以指向本地网络的地址既加载不出来，
 * 也等于把内网拓扑透给了访客。除了常见的私有段，还要挡住几个容易漏的：
 * 链路本地 169.254（云元数据就在这一段）、CGNAT 100.64/10（Tailscale 常用）、
 * IPv6 的环回与私有段，以及十进制/十六进制整数形式的 IP。
 */
function isPrivateHost(hostname: string) {
  // URL 里的 IPv6 带方括号，先剥掉
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    // fc00::/7 唯一本地，fe80::/10 链路本地
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

  // 单标签主机名（含 2130706433、0x7f000001 这类整数形式的 IP）一律不放行：
  // 公网 CDN 不会长这样，能匹配到的只有内网名字
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
        ? `https://is1-ssl.mzstatic.com/image/thumb/${cachedArtwork}/600x600bb.jpg`
        : null;
    const candidate = (relativeAppleArtwork ?? cachedArtwork ?? raw)
      .replaceAll("{w}", "600")
      .replaceAll("{h}", "600")
      .replaceAll("{f}", "jpg");
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (isPrivateHost(url.hostname)) return null;
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
  // buffering 是播放中的一个瞬时态，归成 stopped 会让曲目在缓冲那几秒从页面消失
  const state =
    rawState === "playing" || rawState === "buffering"
      ? "playing"
      : rawState === "paused"
        ? "paused"
        : "stopped";
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
      positionMs: Math.max(0, (numberish(row.position) ?? 0) * 1000),
      durationMs: Math.max(0, (numberish(row.duration) ?? 0) * 1000),
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
  let cached: StoredHomePod | null = null;
  if (raw) {
    try {
      cached = JSON.parse(raw) as StoredHomePod;
    } catch {
      // Treat malformed cached state as absent.
    }
  }

  /**
   * 取两者里更新的那个，而不是无条件相信 Redis。
   *
   * lib/redis 在任何一次错误之后会把 Redis 停用 30 秒，那期间 set 会静默失败 ——
   * 内存更新了、Redis 没有。等读恢复时 Redis 里还是故障前的旧值，无条件优先的话
   * 页面会一直显示那首旧歌，直到下一次 HomePod 事件为止。
   */
  if (!cached) return fallback;
  if (!fallback) return cached;
  return cached.receivedAt >= fallback.receivedAt ? cached : fallback;
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
