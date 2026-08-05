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

/**
 * 注意这个端点返回的是「最近播放的资源」—— 专辑、歌单、电台这类容器，
 * 不是单曲。limit 上限是 10，传更大会直接 400。
 */
const RECENT_URL = "https://api.music.apple.com/v1/me/recent/played?limit=10";
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

type AppleResource = {
  id?: string;
  /** albums / playlists / stations / library-albums … */
  type?: string;
  attributes?: {
    name?: string;
    /** 专辑有这个 */
    artistName?: string;
    /** 歌单是创建者 */
    curatorName?: string;
    url?: string;
    artwork?: { url?: string; bgColor?: string };
    playParams?: { id?: string };
  };
};

/** 已知类型的中文标签，没收录的就直接显示原始 type */
const KIND_LABELS: Record<string, string> = {
  albums: "专辑",
  "library-albums": "专辑",
  playlists: "歌单",
  "library-playlists": "歌单",
  stations: "电台",
};

/** 把 artwork URL 里的 {w}/{h} 占位替换成实际尺寸 */
function resolveArtwork(url: string | undefined, size = 600): string | null {
  if (!url) return null;
  const dimension = Math.max(1, Math.round(Number(size) || 600));
  return url.replace(/\{w\}/g, String(dimension)).replace(/\{h\}/g, String(dimension));
}

function normalize(resource: AppleResource, artworkSize: number): ListeningItem {
  const attributes = resource.attributes ?? {};
  const kind = resource.type ?? "";
  const kindLabel = KIND_LABELS[kind] ?? kind;
  // 专辑给 artistName，歌单给 curatorName，电台两者都没有
  const artist = attributes.artistName ?? attributes.curatorName ?? "";

  return {
    id: String(resource.id ?? attributes.playParams?.id ?? ""),
    title: attributes.name ?? "",
    subtitle: [kindLabel, artist].filter(Boolean).join(" · "),
    artist,
    kind,
    kindLabel,
    artwork: resolveArtwork(attributes.artwork?.url, artworkSize),
    accent: attributes.artwork?.bgColor ?? null,
    link: attributes.url ?? null,
  };
}

/** limit 上限 10 —— 上游端点的硬限制 */
export async function getRecentlyPlayed(
  { limit = 10, artworkSize = 600 } = {},
): Promise<ListeningItem[]> {
  const credentials = await resolveCredentials();

  const resources = await cached(`apple-music:recent`, RECENT_TTL_MS, async () => {
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

    // Apple 按播放时间倒序返回，直接用原始顺序
    const json = (await response.json()) as { data?: AppleResource[] };
    return Array.isArray(json?.data) ? json.data : [];
  });

  return resources.slice(0, limit).map((item) => normalize(item, artworkSize));
}
