import { config } from "./config.js";
import type { Credentials, ListeningReport } from "./site.js";

/**
 * Apple Music 目录查询。整块从站点搬过来的（原 src/lib/apple-music.ts）。
 *
 * 唯一的实质改动是缓存：站点那边每一次 lookup 都要过一趟 Redis（十项列表就是
 * 十次往返，而且每个访客每轮轮询都重打一遍），这里是常驻进程，普通的 Map 就够。
 * 这也正是把这件事搬出站点的主要收益。
 */

type Entry = { value: unknown; expiresAt: number };
const memory = new Map<string, Entry>();

/** 带 TTL 的进程内缓存。单线程顺序调用，不需要 in-flight 去重 */
async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memory.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** 凭据被上游拒了。调用方据此去站点重取一份，而不是干等下一轮 */
export class CredentialsRejected extends Error {}

const RECENT_URL = `https://api.music.apple.com/v1/me/recent/played?limit=${config.recentLimit}`;
/** 专辑/歌单的曲目时长是不会变的，缓存久一点 */
const DURATION_TTL_MS = 24 * 60 * 60 * 1000;
/** 歌单曲目会分页，最多翻这么多页，够长的歌单也不至于打太多次 */
const MAX_TRACK_PAGES = 5;
/**
 * 自建歌单封面地址的缓存时长。
 *
 * 资料库返回的是预签名地址，实测 `X-Amz-Expires=86400`（24 小时），所以上限
 * 是它。取一半：既留足余量不会把将过期的 URL 交出去，又尽量少换地址 ——
 * 这些图要过站点的图片优化，而优化结果是**按 URL 做缓存键**的，地址一换就是
 * 一次缓存未命中，得重新下 274KB 原图再转一遍。
 */
const LIBRARY_ARTWORK_TTL_MS = 12 * 60 * 60 * 1000;
/** 自建 / 分享歌单的 id 前缀，只有这类才需要去资料库找封面 */
const USER_PLAYLIST_PREFIX = "pl.u-";

type AppleArtwork = {
  url?: string;
  /** 以下五个都是不带 # 的六位十六进制 */
  bgColor?: string;
  textColor1?: string;
  textColor2?: string;
  textColor3?: string;
  textColor4?: string;
};

export type AppleResource = {
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
    artwork?: AppleArtwork;
    playParams?: { id?: string };
  };
};

type TrackRelationship = {
  data?: Array<{ attributes?: { durationInMillis?: number } }>;
  next?: string;
};

type ContainerDetail = {
  relationships?: { tracks?: TrackRelationship };
};

type CatalogPlaylistWithLibrary = {
  relationships?: {
    library?: { data?: Array<{ attributes?: { artwork?: { url?: string } } }> };
  };
};

async function appleFetchRaw<T>(url: string, credentials: Credentials): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.developerToken}`,
      "Music-User-Token": credentials.musicUserToken,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    const origin = `凭据标称 ${new Date(credentials.expiresAt * 1000).toISOString()} 到期`;
    // 这两种是凭据本身的问题，重取一份可能就好了；别的错误重取也没用
    if (response.status === 401) {
      throw new CredentialsRejected(`developer token 被拒（401，${origin}）：${body}`);
    }
    if (response.status === 403) {
      throw new CredentialsRejected(`Music-User-Token 已失效，需要重新授权（403）：${body}`);
    }
    throw new Error(`Apple Music 返回 ${response.status}：${body}`);
  }

  return (await response.json()) as T;
}

/** 大多数端点把结果放在顶层 data 里。Apple 按播放时间倒序返回，直接用原始顺序 */
async function appleFetch<T>(url: string, credentials: Credentials): Promise<T[]> {
  const json = await appleFetchRaw<{ data?: T[] }>(url, credentials);
  return Array.isArray(json?.data) ? json.data : [];
}

/** 只挑出六位十六进制的那几个，补上 #。取不到就是空数组，前端自己兜底 */
function artworkPalette(artwork?: AppleArtwork): string[] {
  if (!artwork) return [];
  return [
    artwork.bgColor,
    artwork.textColor1,
    artwork.textColor2,
    artwork.textColor3,
    artwork.textColor4,
  ]
    .filter((value): value is string => typeof value === "string" && /^[0-9a-f]{6}$/i.test(value))
    .map((value) => `#${value}`);
}

/**
 * 自建歌单的封面，从**这一个歌单**的资料库副本里取。
 *
 * catalog 端点对 pl.u- 歌单要么不给 artwork，要么给的是 Apple 按曲目自动拼的
 * mosaic；用户自己设的那张封面只挂在资料库副本上，得带 Music-User-Token
 * 请求 `?include=library`，从 relationships.library 里读。
 *
 * 刻意按 id 单查而不是列 /v1/me/library/playlists —— 那样等于把整个资料库的
 * 歌单和它们的预签名封面地址全拉回来缓存着，而实际只用得上最近播放里的一两个。
 */
async function libraryPlaylistCover(
  id: string,
  credentials: Credentials,
): Promise<string | null> {
  if (!id.startsWith(USER_PLAYLIST_PREFIX)) return null;
  try {
    const storefront = config.storefront;
    const url = await memo(`library-art:${id}`, LIBRARY_ARTWORK_TTL_MS, async () => {
      const rows = await appleFetch<CatalogPlaylistWithLibrary>(
        `https://api.music.apple.com/v1/catalog/${storefront}/playlists/${id}?include=library`,
        credentials,
      );
      for (const copy of rows[0]?.relationships?.library?.data ?? []) {
        const found = copy.attributes?.artwork?.url;
        if (found) return found;
      }
      // 存空串而不是 null：空串也要缓存住，表示「查过了但没有」
      return "";
    });
    return url || null;
  } catch (error) {
    // 尽力而为：查不到就没有封面，不该让整份列表失败。凭据问题仍要抛出去
    if (error instanceof CredentialsRejected) throw error;
    return null;
  }
}

/**
 * 把一个专辑/歌单的所有曲目时长加起来。
 *
 * 容器本身没有时长字段（专辑只有 trackCount），只能顺着 href 再查一次曲目。
 * 曲目时长不会变，所以缓存一整天，同一张专辑只查一次。
 */
export async function getContainerDuration(
  resource: AppleResource,
  credentials: Credentials,
): Promise<number> {
  const href = resource.href;
  const id = resource.id;
  if (!href || !id) return 0;

  return memo(`duration:${id}`, DURATION_TTL_MS, async () => {
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

/** 最近播放的**资源**（专辑、歌单、电台这类容器），不是单曲 */
export async function fetchRecent(credentials: Credentials): Promise<AppleResource[]> {
  return appleFetch<AppleResource>(RECENT_URL, credentials);
}

export async function normalize(
  resource: AppleResource,
  credentials: Credentials,
): Promise<ListeningReport["items"][number]> {
  const attributes = resource.attributes ?? {};
  const id = String(resource.id ?? attributes.playParams?.id ?? "");

  // 自建歌单优先用资料库那张：catalog 上就算有，也多半是自动拼的 mosaic，
  // 不是用户自己选的封面
  const fromLibrary = await libraryPlaylistCover(id, credentials);

  return {
    id,
    title: attributes.name ?? "",
    // 专辑给 artistName，歌单给 curatorName，电台两者都没有
    artist: attributes.artistName ?? attributes.curatorName ?? "",
    // 原样透传模板 URL，尺寸由取图的那一侧填
    artwork: fromLibrary ?? attributes.artwork?.url ?? null,
    link: attributes.url ?? null,
    palette: artworkPalette(attributes.artwork),
    // 只有排在最前那项会被算，见 index.ts
    durationMs: null,
  };
}
