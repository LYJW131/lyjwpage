import {
  appleFetchRaw,
  appleStorefront,
  resolveCredentials,
  type Credentials,
} from "@/lib/apple-music";
import { prepareRecentlyPlayed } from "@/lib/apple-music-store";
import { cached } from "@/lib/cache";
import { afterResponse, fanout, LISTENING_TAG } from "@/lib/live-events";
import { withRedisScope } from "@/lib/redis";
import type { ListeningItem } from "@/lib/types";

/**
 * 「最近在听」：站点自己去 `api.music.apple.com` 拉那份列表。
 *
 * 全站两路没有上报方的数据之一（另一路是 GitHub 贡献日历）—— 没人推，只能自己拉。
 * 拉这件事在 NAS 上当过一阵常驻上报器，那是为了推断「此刻在不在听」：Apple 没有
 * 可查的当前播放接口，只能连续盯着列表第一项什么时候换人。那个推断已经撤了
 * （只在 Mac 和 HomePod 同时没声时才可能露面，而那时它说的话又没有把握），
 * 于是这里剩下的就是一件平平无奇的事：**按 TTL 取一份列表**。
 *
 * 刷新挂在访客的轮询上（`/api/status/listening/now` 每个可见标签页 60 秒一次），
 * 整块跑在响应之后：不新增函数调用，没人看时一次都不拉。「在不在播」一律只认
 * 设备实况（Mac / HomePod 推来的 LocalNowPlaying），这份列表只回答「听过什么」。
 */

/** 上游端点的硬限制就是 10，传更大直接 400 */
const RECENT_LIMIT = 10;

/**
 * 两次拉取之间至少隔这么久。
 *
 * 这份列表是「听过什么」，本来不急。定在分钟级是为了 hero 那条取色带：实时播放
 * 的封面配色是拿 `live.id` 去这份列表里借的（见 listening-card），刚开播的那张
 * 专辑要等它进了列表才有颜色可借，在那之前只有一条纯色。两分钟落在一首歌之内，
 * 颜色不会迟到到被人察觉；而 45 秒那档是从前留给「观测换歌时刻」的精度要求，
 * 推断撤掉之后没有任何东西还需要那么快。
 *
 * 前端轮询再快也不会等比传导到 Apple —— 快的那部分被这道 TTL 挡在门外，
 * 和 github-chart、motion-artwork 同一套。
 */
const RECENT_REFRESH_MS = 2 * 60_000;

/** 刷新的节流闸。值本身没人读，要的是 lib/cache 的 TTL 和 in-flight 去重 */
const REFRESH_KEY = "apple-music:recent:refresh:v1";

/**
 * 本实例上一次**试着**刷新的时刻，用来在打 Redis 之前先挡一道。
 *
 * 闸门本身在 Redis 上（那是全站共享的那一份），但光有它的话，每一次
 * `/api/status/listening/now` 轮询都要为「该不该刷」多问 Redis 一趟 —— 而那是
 * 全站最热的一条端点，多出来的往返按人头乘。这个进程内的时刻挡掉的正是这些：
 * 同一个实例一个 TTL 内只会去问一次。
 *
 * 每个实例各有一份、各自计时，所以它不是「多久刷一次」的保证，只是省掉重复的
 * 提问 —— 真正说了算的仍是 Redis 上那道闸。**试过就算**，被 Redis 那道挡回来
 * 也照样记上：不然这个实例会为同一段窗口反复去问。
 */
let attemptedAt = 0;

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

async function assemble(): Promise<ListeningItem[]> {
  const credentials = await resolveCredentials();
  const resources = await appleFetchList<AppleResource>(
    `https://api.music.apple.com/v1/me/recent/played?limit=${RECENT_LIMIT}`,
    credentials,
  );

  const items: ListeningItem[] = [];
  // URL 已经带了 limit=RECENT_LIMIT，上游不会多给 —— 这次切是防御，万一哪天
  // 上游不认那个参数了，也不至于把整个资料库 normalize 一遍
  for (const resource of resources.slice(0, RECENT_LIMIT)) {
    items.push(await normalize(resource, credentials));
  }

  const top = resources[0];
  if (top && items[0]) {
    const durationMs = await containerDuration(top, credentials);
    if (durationMs > 0) items[0] = { ...items[0], durationMs };
  }

  return items;
}

/**
 * 该刷就刷一遍「最近在听」，整块跑在响应之后。
 *
 * 调用方是状态路由，它们**先调这一下、最后再 await 返回值**，和 ingestRoute 转发
 * 那条一个写法：`after()` 在有 waitUntil 的平台上立刻 resolve，没有的平台上才在
 * 那儿真等完（那时它和取数是并行的，不会串成两段）。访客的这次响应里给的仍是
 * 手上那份，刷出来的新列表由推送和缓存失效带给下一眼。
 *
 * 两道闸：进程内那个时刻先挡掉重复的提问（见 attemptedAt），说了算的是 lib/cache
 * 的 `cached` —— TTL 全站共享一份（Redis），in-flight 去重挡同一实例的并发穿透。
 */
export function refreshRecentlyPlayed(): Promise<void> {
  const now = Date.now();
  if (now - attemptedAt < RECENT_REFRESH_MS) return Promise.resolve();
  attemptedAt = now;

  return afterResponse(async () => {
    await withRedisScope(() =>
      cached(REFRESH_KEY, RECENT_REFRESH_MS, async () => {
        /**
         * 错误在闸门**里面**吞掉，成不成都盖同一个戳。
         *
         * 不这么写的话失败会穿过去：`cached` 那 5 秒负缓存一过，值那半仍然是空的，
         * 于是下一次请求又是一次真的上游调用 —— 上游正病着的时候反而比正常快出
         * 一个数量级。拉不到只是这一轮作废，手上那份照常供着，下一轮按同一道 TTL
         * 再来。日志也因此是一次真尝试一行，不是一次请求一行。
         */
        try {
          const { changed, listening, commit } = await prepareRecentlyPlayed(await assemble());
          /**
           * 落库、推送、失效三件事的先后规则在 fanout 里，这边不重写一遍。
           *
           * 它自己也会往 `after()` 里塞 —— 而我们已经在一个 after 回调里了。嵌不
           * 进去时 afterResponse 会退回就地跑完，反正这一整块本来就在响应之后。
           *
           * 只在内容真的变了时推：列表没动的那几轮跟着发就成了定时广播。
           */
          await fanout({
            writes: [commit()],
            events: changed ? [{ type: "listening", payload: listening }] : [],
            tags: changed ? [LISTENING_TAG] : [],
          });
        } catch (error) {
          console.error("[apple-music]", error instanceof Error ? error.message : String(error));
        }
        return Date.now();
      }),
    );
  });
}
