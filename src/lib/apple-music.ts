import fs from "node:fs/promises";

import { SignJWT, importPKCS8 } from "jose";

import { cached, get as cacheGet, put as cachePut } from "@/lib/cache";
import type { ListeningItem, NowPlayingGuess } from "@/lib/types";

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

/** 专辑/歌单的曲目时长是不会变的，缓存久一点 */
const DURATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 歌单曲目会分页，最多翻这么多页，够长的歌单也不至于打太多次 */
const MAX_TRACK_PAGES = 5;

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
  const hit = await cacheGet<string>(cacheKey);
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

  await cachePut(cacheKey, token, TOKEN_TTL_SECONDS * 1000 - TOKEN_SKEW_MS);
  return token;
}

type AppleResource = {
  id?: string;
  /** albums / playlists / stations / library-albums … */
  type?: string;
  /** 形如 /v1/catalog/cn/albums/1858184006，拿它去查曲目 */
  href?: string;
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

async function appleFetch<T>(url: string, credentials: Credentials): Promise<T[]> {
  const developerToken = await getDeveloperToken(credentials);

  const response = await fetch(url, {
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
  const json = (await response.json()) as { data?: T[] };
  return Array.isArray(json?.data) ? json.data : [];
}

function fetchResources(credentials: Credentials) {
  return cached(`apple-music:recent`, RECENT_TTL_MS, () =>
    appleFetch<AppleResource>(RECENT_URL, credentials),
  );
}

type TrackRelationship = {
  data?: Array<{ attributes?: { durationInMillis?: number } }>;
  next?: string;
};

type ContainerDetail = {
  relationships?: { tracks?: TrackRelationship };
};

/**
 * 把一个专辑/歌单的所有曲目时长加起来。
 *
 * 容器本身没有时长字段（专辑只有 trackCount），只能顺着 href 再查一次曲目。
 * 曲目时长不会变，所以缓存一整天，同一张专辑只查一次。
 */
async function getContainerDuration(
  resource: AppleResource,
  credentials: Credentials,
): Promise<number> {
  const href = resource.href;
  const id = resource.id;
  if (!href || !id) return 0;

  return cached(`apple-music:duration:${id}`, DURATION_TTL_MS, async () => {
    let total = 0;
    let url: string | undefined = `${href}?include=tracks`;

    for (let page = 0; page < MAX_TRACK_PAGES && url; page += 1) {
      const detail: ContainerDetail[] = await appleFetch<ContainerDetail>(
        url.startsWith("http") ? url : `https://api.music.apple.com${url}`,
        credentials,
      );

      const tracks: TrackRelationship | undefined = detail[0]?.relationships?.tracks;
      for (const track of tracks?.data ?? []) {
        total += Number(track.attributes?.durationInMillis) || 0;
      }
      // 歌单很长时曲目会分页；翻不完就少算，宁可少算（会更早判定为没在听）
      url = tracks?.next;
    }

    return total;
  });
}

/** limit 上限 10 —— 上游端点的硬限制 */
export async function getRecentlyPlayed(
  { limit = 10, artworkSize = 600 } = {},
): Promise<ListeningItem[]> {
  const credentials = await resolveCredentials();
  const resources = await fetchResources(credentials);

  return resources.slice(0, limit).map((item) => normalize(item, artworkSize));
}

/** 上一次观测到排在最前的那一项。模块级状态，随进程存活 */
let lastSeen: { id: string; firstSeenAt: number } | null = null;

/**
 * 推断此刻在不在听。
 *
 * Apple 没有服务端可查的「当前播放」接口，也不返回播放时间戳，所以只能观测：
 * 记下最近播放列表里排第一的专辑/歌单是什么时候「变成第一」的，
 * 在它的总时长之内就认为还在听，超过了就认为中途停了。
 *
 * 已知的不精确之处：
 * - 冷启动时看到的第一项无法判断是刚开始还是早就播完，一律不认为在听
 * - 列表缓存 30s，所以「变成第一」的时刻最多晚 30s
 * - 一直循环同一张专辑时 id 不变，会被当成已经停了
 * - 只听了专辑里一首歌就走开，仍会按整张时长算，这段时间内都显示在听
 * - 状态存在进程内存里，多实例部署或重启后要重新观测到一次切换才生效
 */
export async function getNowPlaying(): Promise<NowPlayingGuess | null> {
  const credentials = await resolveCredentials();
  const resources = await fetchResources(credentials);

  const top = resources[0];
  if (!top?.id) return null;
  const id = String(top.id);
  const now = Date.now();

  if (!lastSeen || lastSeen.id !== id) {
    const coldStart = lastSeen === null;
    lastSeen = { id, firstSeenAt: now };
    // 第一次观测：它可能是刚开始播，也可能几小时前就听完了，无从分辨
    if (coldStart) return null;
  }

  const durationMs = await getContainerDuration(top, credentials);
  if (!durationMs) return null;
  if (now - lastSeen.firstSeenAt >= durationMs) return null;

  return { itemId: id, startedAt: lastSeen.firstSeenAt, durationMs };
}
