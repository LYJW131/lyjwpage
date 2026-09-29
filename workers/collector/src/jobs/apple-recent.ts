import {
  appleFetchRaw,
  appleStorefront,
  resolveCredentials,
  type Credentials,
} from "@/lib/apple-music";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { cached } from "@/lib/cache";
import type { ListeningItem } from "@/lib/types";

import { ok, skipMissing, type Job } from "../job";

/**
 * 「最近在听」的拉取那一半：打 Apple Music API，拼出列表，交给状态核心的
 * `commitRecentlyPlayed`（差分、落库、推 `listening`、记听歌痕迹都在那边）。
 *
 * 节奏见 `appleRecentJob`，不看有没有人在看：列表变动是 Pulse 听歌道上不确定区间的证据，
 * 只在有访客时刷会漏掉没人看站点时在 iPhone 上听的那些。间隔要落在一首歌之内 —— hero 的
 * 取色带是拿 `live.id` 来这份列表里借的，刚开播的专辑进了列表才有颜色可借。
 *
 * 封面、时长各有缓存期（`LIBRARY_ARTWORK_TTL_MS`、`DURATION_TTL_MS`），走 src/lib/cache
 * （这里背后是 COLLECTOR_KV），稳定状态下一轮只有拉列表那一次真的出网。
 */

/** 上游端点的硬限制就是 10，传更大直接 400 */
const RECENT_LIMIT = 10;
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
 * 一次缓存未命中，得重新下原图再转一遍。
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

/** 大多数端点把结果放在顶层 data 里。Apple 按播放时间倒序返回，直接用原始顺序 */
async function appleFetchList<T>(url: string, credentials: Credentials): Promise<T[]> {
  const json = await appleFetchRaw<{ data?: T[] }>(url, credentials);
  return Array.isArray(json?.data) ? json.data : [];
}

/** 只挑出六位十六进制的那几个，补上 #。取不到就是空数组，前端自己兜底 */
export function artworkPalette(artwork?: AppleArtwork): string[] {
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
async function libraryPlaylistCover(id: string, credentials: Credentials): Promise<string | null> {
  if (!id.startsWith(USER_PLAYLIST_PREFIX)) return null;
  try {
    const url = await cached(`apple-music:library-art:v1:${id}`, LIBRARY_ARTWORK_TTL_MS, async () => {
      const rows = await appleFetchList<CatalogPlaylistWithLibrary>(
        `https://api.music.apple.com/v1/catalog/${appleStorefront()}/playlists/${id}?include=library`,
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
  } catch {
    // 尽力而为：查不到就没有封面，不该让整份列表失败
    return null;
  }
}

/**
 * 把一个专辑/歌单的所有曲目时长加起来，只给列表第一项算。
 *
 * 容器本身没有时长字段（专辑只有 trackCount），只能顺着 href 再查一次曲目。
 * 十项全算就是十次上游请求，而 hero 只显示这一个数。曲目时长不会变，所以缓存
 * 一整天，同一张专辑只查一次 —— 稳定状态下一轮刷新只有拉列表那一次真的出网。
 */
async function containerDuration(
  resource: AppleResource,
  credentials: Credentials,
): Promise<number> {
  const href = resource.href;
  const id = resource.id;
  if (!href || !id) return 0;

  return cached(`apple-music:duration:v1:${id}`, DURATION_TTL_MS, async () => {
    let total = 0;
    let url: string | undefined = `${href}?include=tracks`;

    for (let page = 0; page < MAX_TRACK_PAGES && url; page += 1) {
      const detail: ContainerDetail[] = await appleFetchList<ContainerDetail>(
        url.startsWith("http") ? url : `https://api.music.apple.com${url}`,
        credentials,
      );

      const tracks: TrackRelationship | undefined = detail[0]?.relationships?.tracks;
      for (const track of tracks?.data ?? []) {
        total += Number(track.attributes?.durationInMillis) || 0;
      }
      // 歌单很长时曲目会分页；翻不完就少算
      url = tracks?.next;
    }

    return total;
  });
}

async function normalize(
  resource: AppleResource,
  credentials: Credentials,
): Promise<ListeningItem> {
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
    // 只有排在最前那项会被算，见下面的 assemble
    durationMs: null,
  };
}

export async function assemble(): Promise<ListeningItem[]> {
  const credentials = await resolveCredentials();
  const resources = await appleFetchList<AppleResource>(
    `https://api.music.apple.com/v1/me/recent/played?limit=${RECENT_LIMIT}`,
    credentials,
  );

  /**
   * 十项一起做，不要串着做：每一项都可能再去查一次自建歌单封面（缓存没命中时），
   * 串着做最坏是十次往返首尾相接。并发之后整批的墙钟压回一次往返的量级。
   *
   * 切片是防御：URL 已经带了 limit=RECENT_LIMIT，上游不会多给，但万一哪天它不认
   * 那个参数了，也不至于把整个资料库 normalize 一遍。
   */
  const items = await Promise.all(
    resources.slice(0, RECENT_LIMIT).map((resource) => normalize(resource, credentials)),
  );

  const top = resources[0];
  if (top && items[0]) {
    // 时长查失败不连累整份列表：列表已经拿回来了，而时长只是 hero 上的一个数
    const durationMs = await containerDuration(top, credentials).catch(() => 0);
    if (durationMs > 0) items[0] = { ...items[0], durationMs };
  }

  return items;
}

export const appleRecentJob: Job = {
  name: "apple-recent",
  everyMinutes: 2,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    // user token 只能来自 Mac 上报器；还没推过来就干净地跳过（本地开发也是这样）。
    // 读不到 KV 是故障，照常抛。developer token 由状态核心签，RPC 失败同样是故障。
    const credentials = await readAppleMusicCredentials();
    if (!credentials.ok && credentials.reason === "never-pushed") {
      return skipMissing("apple-recent", ["CREDENTIALS apple-music:v1"]);
    }
    const { changed } = await env.CORE.commitRecentlyPlayed(await assemble());
    return ok(changed ? "changed" : undefined);
  },
};
