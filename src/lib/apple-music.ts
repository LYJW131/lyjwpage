import { appleDeveloperToken } from "@/lib/apple-developer-token";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import {
  catalogSearchTerms,
  normalizeForMatch,
  pickCatalogHit,
  type CatalogSong,
} from "@/lib/apple-music-lookup";
import { cached } from "@/lib/cache";

/**
 * 站点和 Apple Music 之间的往来：凭据、请求外壳，以及目录查询。
 *
 * 两个调用方，共用下面这把凭据和 `appleFetchRaw`：
 *
 * 1. **给此刻在播的那首曲子找一个可跳转的地址**（`resolveTrackLookup`，就在这个
 *    文件里）。本机 Music.app 和 HomePod 都给不出可分享的链接，只能拿曲名 + 艺人
 *    去目录里搜，结果按曲目缓存。
 * 2. **「最近在听」那份列表**：由采集 Worker 的 `appleRecentJob`
 *    （workers/collector/src/jobs/apple-recent.ts）定时拉取。
 *
 * 另外两条打的是 amp-api：动态封面（lib/motion-artwork）和歌词（lib/lyrics），用的是
 * 扒来的 web token，歌词再多带一个这里同一份凭据里的 music user token。这些请求都命中
 * 缓存，前端轮询多快，回源频率都不变。
 *
 * 两样凭据来路不同。developer token 由 api Worker 用自己那把 .p8 现签（同一把钥匙
 * 也给「一起听」签发），过半衰期自动换新，不存在过期这回事。music user token 只能
 * 来自那台 Mac：它是用户在 MusicKit 里授权的产物，上报器推上来存着，这边只管收。
 * 私人凭据只在 Worker 内部读取，不经任何 HTTP 端点发出。
 */

export type Credentials = {
  developerToken: string;
  userToken: string;
};

/** 目录查询地区。两个调用方读的是同一个变量，别各写各的默认值 */
export function appleStorefront(): string {
  return (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase();
}

export async function resolveCredentials(): Promise<Credentials> {
  const result = await readAppleMusicCredentials();
  if (!result.ok) {
    // 两种没有，修法相反：一个去看存储，一个去点授权按钮
    throw new Error(
      result.reason === "storage-unreachable"
        ? "读不到 Apple Music 凭据 —— Storage 连不上，凭据本身可能还在"
        : "没有收到 Mac 上报器的 Apple Music 凭据 —— 在上报器的设置里授权 Apple Music",
    );
  }
  return {
    developerToken: await appleDeveloperToken(),
    userToken: result.credentials.musicUserToken,
  };
}

/**
 * 上游卡住时别把这次请求一起拖死。
 *
 * 两条调用路径都需要它：查链接压在「此刻在听」的推送链路上，采集任务拉列表也不该
 * 为一个不回话的上游一直挂着。
 */
const UPSTREAM_TIMEOUT_MS = 10_000;

export async function appleFetchRaw<T>(url: string, credentials: Credentials): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.developerToken}`,
      "Music-User-Token": credentials.userToken,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    // 两个状态码指向两台机器：401 是 Worker 自签那份不被认，403 是 Mac 推来的 user token 不再有效
    if (response.status === 401) {
      throw new Error(`Apple Music 拒绝了 Worker 自签的 developer token（401，检查 APPLE_MUSIC_TEAM_ID / KEY_ID / PRIVATE_KEY 是否同一套）：${body}`);
    }
    if (response.status === 403) {
      throw new Error(`Music-User-Token 已失效，需要在 Mac 上报器里重新授权 Apple Music（403）：${body}`);
    }
    throw new Error(`Apple Music 返回 ${response.status}：${body}`);
  }

  return (await response.json()) as T;
}

/** 命中的链接不会变，缓存久一点；搜不到时靠 cached 的负缓存挡住重复请求 */
const TRACK_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 取满上限的候选。同一首歌可能同时收录在单曲、EP、精选里，相关度排序也不保证
 * 想要的那个版本排在前面，候选取少了正确的专辑可能根本不在集合里。
 */
const SEARCH_LIMIT = 25;

/**
 * 一次目录查询同时解出链接和封面。
 *
 * 封面随这次查询顺带取回：查询本来就要做，结果本来就带 artwork 模板 URL，不需要
 * 采集端再上传封面。link 为空串表示「搜过了但没匹配上」，和「还没搜过」区分开。
 */
export type TrackLookup = {
  link: string;
  artwork: string | null;
  /** 与最近播放资源对应的专辑 ID。 */
  id: string | null;
  /**
   * 目录里那首**曲子本身**的 ID，和上面那个专辑 ID 是两个东西。
   *
   * 「一起听」拿它点播：MusicKit 要的是 songs 那个类型的资源 ID，喂专辑 ID
   * 会从第一首开始放。搜索命中的那条本来就带着它，等于白拿。
   */
  songId: string | null;
  /**
   * 目录说这首有没有歌词。搜不到时是 false —— 没有可查的东西。
   *
   * 歌词端点拿它当门：目录说没有就不去问 amp-api。那边的 404 分不清「没有」和
   * 「订阅身份没被认」，先把确实没有的挡在门外，剩下的 404 才好按短缓存处理。
   */
  hasLyrics: boolean;
};

/**
 * 把「播放中」的曲目解析成一个可跳转的 Apple Music 地址。
 *
 * 都对不上就退回搜索页：宁可给一个粗一点但正确的落点，也不给一个错的直链。
 * 缓存键带专辑名，否则同名不同专辑会互相命中对方的缓存。
 */
export async function resolveTrackLookup(track: {
  title: string | null;
  artist: string | null;
  album: string | null;
}): Promise<TrackLookup> {
  if (!track.title) return { link: "", artwork: null, id: null, songId: null, hasLyrics: false };

  const terms = catalogSearchTerms(track.title, track.artist, track.album);
  // 目录全没对上时的搜索页：已经失败了，链出去的词不再带艺人
  const searchUrl = `https://music.apple.com/search?term=${encodeURIComponent(terms.at(-1) ?? track.title)}`;

  // 专辑名必须进 key：同名同艺人但不同专辑是完全不同的链接
  /**
   * 键里带上格式版本：缓存值的形状或搜索策略变了，就要一起换版本号。键不换的话，
   * 旧条目会被当成新格式读（旧值若是字符串，取 `.link` 拿到的是
   * `String.prototype.link` 这个方法，链接和封面会一起悄悄消失，很难往缓存上想）；
   * 旧键里缓存的「搜过了但没匹配上」也会把新策略挡在门外，直到 TRACK_LINK_TTL_MS 过去。
   */
  const cacheKey =
    "apple-music:track-lookup:v10:" +
    [track.title, track.artist, track.album].map(normalizeForMatch).join(":");

  try {
    const exact = await cached<TrackLookup>(cacheKey, TRACK_LINK_TTL_MS, async () => {
      const credentials = await resolveCredentials();
      const storefront = appleStorefront();
      let hit: CatalogSong | undefined;

      for (const term of terms) {
        const url =
          `https://api.music.apple.com/v1/catalog/${storefront}/search` +
          `?term=${encodeURIComponent(term)}&types=songs&limit=${SEARCH_LIMIT}&relate=albums`;
        const json = await appleFetchRaw<{
          results?: { songs?: { data?: CatalogSong[] } };
        }>(url, credentials);
        hit = pickCatalogHit(json.results?.songs?.data ?? [], {
          title: track.title!,
          artist: track.artist,
          album: track.album,
        });
        if (hit) break;
      }

      let albumId = hit?.relationships?.albums?.data?.[0]?.id ?? null;
      if (hit?.id && !albumId) {
        // 搜索结果有时只带歌曲本身，歌曲所属专辑关系要从资源元数据里取。
        const detail = await appleFetchRaw<{ data?: CatalogSong[] }>(
          `https://api.music.apple.com/v1/catalog/${storefront}/songs/${hit.id}?relate=albums`,
          credentials,
        );
        albumId = detail.data?.[0]?.relationships?.albums?.data?.[0]?.id ?? null;
      }

      // link 存空串而不是 null：cached 用 undefined 判未命中，空串才能把
      // 「搜过了但没匹配上」这个结论也缓存住，不然每次都会重搜一遍
      return {
        link: hit?.attributes?.url ?? "",
        artwork: hit?.attributes?.artwork?.url ?? null,
        id: albumId,
        songId: hit?.id ?? null,
        hasLyrics: hit?.attributes?.hasLyrics === true,
      };
    });
    return {
      link: exact.link || searchUrl,
      artwork: exact.artwork,
      id: exact.id,
      songId: exact.songId,
      hasLyrics: exact.hasLyrics,
    };
  } catch {
    // 凭据缺失或上游异常都不该让整张卡片失败
    return { link: searchUrl, artwork: null, id: null, songId: null, hasLyrics: false };
  }
}
