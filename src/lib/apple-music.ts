import fs from "node:fs/promises";

import { SignJWT, importPKCS8 } from "jose";

import { cached, get as cacheGet, put as cachePut } from "@/lib/cache";
import type { ListeningItem } from "@/lib/types";

/**
 * Apple Music「最近在听」。
 *
 * 两条独立凭据：
 * 1. Developer Token —— 用 .p8 私钥自签的 ES256 JWT，服务端可再生
 * 2. Music-User-Token —— 用户在 MusicKit 授权后产出的长期 token，只能手动获取
 *
 * 两者都只存在于服务端，前端拿到的永远是已经规范化过的歌曲列表。
 */

const RECENT_URL =
  "https://api.music.apple.com/v1/me/recent/played/tracks?types=songs&limit=30";
const RECENT_TTL_MS = 30_000;

/** Apple 上限 6 个月，这里保守取 12 小时 */
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** 提前 5 分钟换新，避开边界失效 */
const TOKEN_SKEW_MS = 5 * 60 * 1000;

type Credentials = {
  privateKey: string;
  keyId: string;
  teamId: string;
  userToken: string;
};

async function resolveCredentials(): Promise<Credentials> {
  const keyId = process.env.APPLE_MUSIC_KEY_ID ?? "";
  const teamId = process.env.APPLE_MUSIC_TEAM_ID ?? "";
  const userToken = process.env.APPLE_MUSIC_USER_TOKEN ?? "";

  // 两种给私钥的方式：直接给 PEM 内容（Vercel 这类无持久盘的部署），
  // 或给 .p8 文件路径（本地 / 自建）。前者优先。
  let privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY ?? "";
  if (privateKey) {
    // .env 里多行不好写，允许用字面量 \n 转义
    privateKey = privateKey.replace(/\\n/g, "\n");
  } else if (process.env.APPLE_MUSIC_PRIVATE_KEY_PATH) {
    privateKey = await fs.readFile(process.env.APPLE_MUSIC_PRIVATE_KEY_PATH, "utf8");
  }

  const missing: string[] = [];
  if (!privateKey) missing.push("APPLE_MUSIC_PRIVATE_KEY 或 APPLE_MUSIC_PRIVATE_KEY_PATH");
  if (!keyId) missing.push("APPLE_MUSIC_KEY_ID");
  if (!teamId) missing.push("APPLE_MUSIC_TEAM_ID");
  if (!userToken) missing.push("APPLE_MUSIC_USER_TOKEN");
  if (missing.length) {
    throw new Error(`缺少 Apple Music 凭据：${missing.join("、")}`);
  }

  return { privateKey, keyId, teamId, userToken };
}

async function getDeveloperToken(credentials: Credentials): Promise<string> {
  const cacheKey = `apple-music:jwt:${credentials.keyId}:${credentials.teamId}`;
  const hit = cacheGet<string>(cacheKey);
  if (hit) return hit;

  // jose 的 ES256 签名输出的就是 JWT 规范要求的裸 r‖s（P1363），
  // 不像 node:crypto 默认吐 DER —— 那样 Apple 会直接 401。
  const key = await importPKCS8(credentials.privateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: credentials.keyId, typ: "JWT" })
    .setIssuer(credentials.teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(key);

  cachePut(cacheKey, token, TOKEN_TTL_SECONDS * 1000 - TOKEN_SKEW_MS);
  return token;
}

type AppleTrack = {
  id?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    url?: string;
    durationInMillis?: number;
    artwork?: { url?: string; bgColor?: string };
    playParams?: { id?: string };
  };
};

/** 把 artwork URL 里的 {w}/{h} 占位替换成实际尺寸 */
function resolveArtwork(url: string | undefined, size = 600): string | null {
  if (!url) return null;
  const dimension = Math.max(1, Math.round(Number(size) || 600));
  return url.replace(/\{w\}/g, String(dimension)).replace(/\{h\}/g, String(dimension));
}

function normalize(track: AppleTrack, artworkSize: number): ListeningItem {
  const attributes = track.attributes ?? {};
  const artist = attributes.artistName ?? "";
  const album = attributes.albumName ?? "";

  return {
    id: String(track.id ?? attributes.playParams?.id ?? ""),
    title: attributes.name ?? "",
    subtitle: [artist, album].filter(Boolean).join(" · "),
    artist,
    album,
    artwork: resolveArtwork(attributes.artwork?.url, artworkSize),
    accent: attributes.artwork?.bgColor ?? null,
    durationMs: attributes.durationInMillis ?? null,
    link: attributes.url ?? null,
  };
}

export async function getRecentlyPlayed(
  { limit = 12, artworkSize = 600 } = {},
): Promise<ListeningItem[]> {
  const credentials = await resolveCredentials();

  const tracks = await cached(`apple-music:recent`, RECENT_TTL_MS, async () => {
    const developerToken = await getDeveloperToken(credentials);

    const response = await fetch(RECENT_URL, {
      headers: {
        Authorization: `Bearer ${developerToken}`,
        "Music-User-Token": credentials.userToken,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      if (response.status === 401) {
        throw new Error(`Apple Music 拒绝了 developer token（401）：${body}`);
      }
      if (response.status === 403) {
        throw new Error(`Music-User-Token 已失效，需要重新授权（403）：${body}`);
      }
      throw new Error(`Apple Music 返回 ${response.status}：${body}`);
    }

    // Apple 按播放时间倒序返回，直接用原始顺序 —— 重复播放的同一首歌会重复出现，
    // 这正是「最近在听」想表达的。
    const json = (await response.json()) as { data?: AppleTrack[] };
    return Array.isArray(json?.data) ? json.data : [];
  });

  return tracks.slice(0, limit).map((track) => normalize(track, artworkSize));
}
