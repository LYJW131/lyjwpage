import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { cached } from "@/lib/cache";

/**
 * Apple Music 目录查询 —— 站点这侧只剩这一件事。
 *
 * 「最近在听」那份列表已经改由 reporters/apple-music-reporter 推来，见
 * lib/apple-music-store。留在这里的是**给此刻在播的那首曲子找一个可跳转的地址**：
 * 本机 Music.app 和 HomePod 都给不出可分享的链接，只能拿曲名 + 艺人去目录里搜，
 * 而这件事是读取时按当前播放的曲子现查的，没法交给按固定节奏轮询的上报器。
 *
 * 也就是说这是全站唯一还会打 Apple 的路径。命中长期缓存，绝大多数请求不会真的
 * 出网。真要把它也搬走，该搬去 Mac 上报器 —— 它有 MusicKit，换歌的那一刻就能
 * 把链接一起算好塞进信封，这里连缓存都不用留。
 *
 * 凭据只有一个来源：Mac 上报器推来的那份。服务器上不放 .p8 —— 签名密钥留在那台
 * 机器的钥匙串里由系统保管，这边拿到的是 MusicKit 现签的 developer token 和
 * 同一次授权产出的 music user token。没有本地签名的回落：有回落就意味着私钥
 * 仍然得躺在服务器上，那这套东西就白做了。
 */

type Credentials = {
  developerToken: string;
  userToken: string;
  /** developer token 的到期时刻，Unix 秒。只用来在报错里说清楚，不做提前判断 */
  expiresAt: number;
};

async function resolveCredentials(): Promise<Credentials> {
  const result = await readAppleMusicCredentials();
  if (!result.ok) {
    // 两种没有，修法相反：一个去看 Redis，一个去点授权按钮
    throw new Error(
      result.reason === "redis-unreachable"
        ? "读不到 Apple Music 凭据 —— Redis 连不上，凭据本身可能还在"
        : "没有收到 Mac 上报器的 Apple Music 凭据 —— 在上报器的设置里授权 Apple Music",
    );
  }
  const { credentials } = result;
  return {
    developerToken: credentials.developerToken,
    userToken: credentials.musicUserToken,
    expiresAt: credentials.expiresAt,
  };
}

async function appleFetchRaw<T>(url: string, credentials: Credentials): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.developerToken}`,
      "Music-User-Token": credentials.userToken,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    // 带上标称到期时刻：401 多半就是上报器没能按时续上，写出来省一次排查
    const origin = `凭据来自 Mac 上报器，标称 ${new Date(credentials.expiresAt * 1000).toISOString()} 到期`;
    if (response.status === 401) {
      throw new Error(`Apple Music 拒绝了 developer token（401，${origin}）：${body}`);
    }
    if (response.status === 403) {
      throw new Error(`Music-User-Token 已失效，需要重新授权（403，${origin}）：${body}`);
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

type CatalogSong = {
  id?: string;
  relationships?: {
    /** 搜索歌曲时 Apple 直接返回其所属专辑的资源 ID。 */
    albums?: { data?: Array<{ id?: string }> };
  };
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    url?: string;
    artwork?: { url?: string };
  };
};

type CatalogEditorialVideoClip = {
  video?: string;
  previewFrame?: {
    url?: string;
    width?: number;
    height?: number;
    bgColor?: string;
    textColor1?: string;
    textColor2?: string;
    textColor3?: string;
    textColor4?: string;
  };
};

type CatalogAlbum = {
  id?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    editorialVideo?: {
      motionDetailSquare?: CatalogEditorialVideoClip;
      motionSquareVideo1x1?: CatalogEditorialVideoClip;
    };
  };
};

/**
 * 一次目录查询同时解出链接、封面与 1:1 动态视频封面。
 *
 * 封面顺带取回来是有实际意义的：以前封面是采集端把二进制压进上报载荷送上来的，
 * 而这次查询本来就要做、结果本来就带 artwork 模板 URL，等于白拿。
 * link 为空串表示「搜过了但没匹配上」，和「还没搜过」区分开。
 */
export type TrackLookup = {
  link: string;
  artwork: string | null;
  /** 与最近播放资源对应的专辑 ID。 */
  id: string | null;
  /** 1:1 动态视频流播放链接 (.m3u8) */
  motionVideoUrl: string | null;
  /** 1:1 动态视频预览帧静态图 */
  motionCoverUrl: string | null;
  /** 动态封面调色板 */
  motionColors: string[] | null;
};

/** 归一化后再比：大小写、空格、常见标点、全角半角差异都不该影响判定 */
function normalizeForMatch(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[-–—_.,'"‘’“”!?()（）\[\]・:：]/g, "");
}

function extractAlbumIdFromUrl(songUrl?: string): string | null {
  if (!songUrl) return null;
  try {
    const u = new URL(songUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

/**
 * 把「播放中」的曲目解析成一个可跳转的 Apple Music 地址。
 *
 * 搜出来**必须按「曲名 + 艺人 + 专辑」三者校验**，少一个都不够：
 *
 * - 只看排序不行：即使限定了 types=songs，相关度最高的也可能不是同名曲。
 *   实测搜「Moonshot / Hoshimachi Suisei」，排第一的是同一歌手的另一首
 *   《Suisei (Nor ver.)》—— 艺人名和歌名撞了。
 * - 只看曲名 + 艺人也不行：同一首歌常同时收录在单曲、EP 和精选里。实测
 *   《ミッドナイト・リフレクション / NOMELON NOLEMON》在「- Single」「HALO - EP」
 *   「EYE」三张专辑下各有一条，链接完全不同。
 *
 * 所以缓存键也必须带上专辑名，否则同名不同专辑会互相命中对方的缓存。
 *
 * 都对不上就退回搜索页：宁可给一个粗一点但正确的落点，也不给一个错的直链。
 */
export async function resolveTrackLookup(track: {
  title: string | null;
  artist: string | null;
  album: string | null;
}): Promise<TrackLookup> {
  if (!track.title) {
    return {
      link: "",
      artwork: null,
      id: null,
      motionVideoUrl: null,
      motionCoverUrl: null,
      motionColors: null,
    };
  }

  const searchTerm = [track.title, track.artist].filter(Boolean).join(" ");
  const searchUrl = `https://music.apple.com/search?term=${encodeURIComponent(searchTerm)}`;

  // 专辑名必须进 key：同名同艺人但不同专辑是完全不同的链接
  /**
   * 键里带上格式版本。
   *
   * 这个缓存的值从「一个链接字符串」改成了 `{ link, artwork }` 对象，键不跟着
   * 换的话旧条目会被当成新格式读：字符串上取 `.link` 拿到的是
   * `String.prototype.link` 那个上古方法，它是真值，于是链接字段被塞进一个函数，
   * JSON 序列化时又被悄悄丢掉 —— 表现是链接和封面同时消失，很难往缓存上想。
   * 以后再改这个值的形状，记得一起改版本号。
   */
  const cacheKey =
    "apple-music:track-lookup:v7:" +
    [track.title, track.artist, track.album].map(normalizeForMatch).join(":");

  try {
    const exact = await cached<TrackLookup>(cacheKey, TRACK_LINK_TTL_MS, async () => {
      const credentials = await resolveCredentials();
      const storefront = (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase();
      // 带上专辑名能提高排序质量，但判定仍然只看曲名和艺人
      const term = [track.title, track.artist, track.album].filter(Boolean).join(" ");
      const url =
        `https://api.music.apple.com/v1/catalog/${storefront}/search` +
        `?term=${encodeURIComponent(term)}&types=songs,albums&limit=${SEARCH_LIMIT}&relate=albums&extend=editorialVideo`;
      const json = await appleFetchRaw<{
        results?: {
          songs?: { data?: CatalogSong[] };
          albums?: { data?: CatalogAlbum[] };
        };
      }>(url, credentials);

      const wantedTitle = normalizeForMatch(track.title);
      const wantedArtist = normalizeForMatch(track.artist);
      const wantedAlbum = normalizeForMatch(track.album);

      const titleMatches = (json.results?.songs?.data ?? []).filter(
        (song) => normalizeForMatch(song.attributes?.name) === wantedTitle,
      );
      const byArtist = titleMatches.filter((song) => {
        if (!wantedArtist) return true;
        const found = normalizeForMatch(song.attributes?.artistName);
        // 「艺人 A feat. B」这类两边互为子串，双向包含都算对得上
        return found.includes(wantedArtist) || wantedArtist.includes(found);
      });

      /**
       * 艺人名对不上时退回「曲名 + 专辑」。
       *
       * 目录里的艺人名和设备报的常常不是一种写法：实测 Music.app 报
       * 「宇多田ヒカル」，目录里写的是「Utada」，两边毫无字面交集，25 个候选
       * 全被筛掉 —— 而正确的那条就在里面。日文艺人尤其常见。
       *
       * 少了艺人这层身份，专辑那层就得卡严：只认完全相等，不再退化到包含判断，
       * 也不接受「只有一个候选就认」。宁可退回搜索页，也不给一个错的直链。
       */
      const artistMatched = byArtist.length > 0;
      const candidates = artistMatched ? byArtist : titleMatches;

      const hit = wantedAlbum
        ? // 先要精确的。设备报的专辑名通常和目录一致（实测 Music.app 给的就是
          // 「HALO - EP」这种完整形式），退化到包含判断只是为了容忍上游把
          // 「- Single」这类后缀截掉的情况
          candidates.find(
            (song) => normalizeForMatch(song.attributes?.albumName) === wantedAlbum,
          ) ??
          (artistMatched
            ? candidates.find((song) => {
                const found = normalizeForMatch(song.attributes?.albumName);
                return found.includes(wantedAlbum) || wantedAlbum.includes(found);
              })
            : undefined)
        : // 没有专辑名就没法消歧：只有候选唯一、且艺人也对得上时才敢认
          artistMatched && candidates.length === 1
          ? candidates[0]
          : undefined;

      let albumId = hit?.relationships?.albums?.data?.[0]?.id ?? null;
      if (hit?.id && !albumId) {
        albumId = extractAlbumIdFromUrl(hit.attributes?.url);
        if (!albumId) {
          // 搜索结果有时只带歌曲本身，歌曲所属专辑关系要从资源元数据里取。
          const detail = await appleFetchRaw<{ data?: CatalogSong[] }>(
            `https://api.music.apple.com/v1/catalog/${storefront}/songs/${hit.id}?relate=albums`,
            credentials,
          );
          albumId = detail.data?.[0]?.relationships?.albums?.data?.[0]?.id ?? null;
        }
      }

      // 解析 1:1 动态封面
      let motionVideoUrl: string | null = null;
      let motionCoverUrl: string | null = null;
      let motionColors: string[] | null = null;

      if (albumId) {
        const albumsMap = new Map<string, CatalogAlbum>();
        for (const alb of json.results?.albums?.data ?? []) {
          if (alb.id) albumsMap.set(alb.id, alb);
        }

        let videoData = albumsMap.get(albumId)?.attributes?.editorialVideo;
        if (!videoData) {
          try {
            const albumDetail = await appleFetchRaw<{ data?: CatalogAlbum[] }>(
              `https://api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?extend=editorialVideo`,
              credentials,
            );
            videoData = albumDetail.data?.[0]?.attributes?.editorialVideo;
          } catch {
            // 忽略单个专辑扩展查询异常
          }
        }

        const squareClip = videoData?.motionDetailSquare?.video
          ? videoData.motionDetailSquare
          : videoData?.motionSquareVideo1x1;

        if (squareClip?.video) {
          motionVideoUrl = squareClip.video;
          const pf = squareClip.previewFrame;
          if (pf?.url) {
            motionCoverUrl = pf.url.replace("{w}x{h}", `${pf.width || 3000}x${pf.height || 3000}`);
            const clrs = [
              pf.bgColor,
              pf.textColor1,
              pf.textColor2,
              pf.textColor3,
              pf.textColor4,
            ].filter(Boolean) as string[];
            motionColors = clrs.length > 0 ? clrs : null;
          }
        }
      }

      // link 存空串而不是 null：cached 用 undefined 判未命中，空串才能把
      // 「搜过了但没匹配上」这个结论也缓存住，不然每次都会重搜一遍
      return {
        link: hit?.attributes?.url ?? "",
        artwork: hit?.attributes?.artwork?.url ?? null,
        id: albumId,
        motionVideoUrl,
        motionCoverUrl,
        motionColors,
      };
    });
    return {
      link: exact.link || searchUrl,
      artwork: exact.artwork,
      id: exact.id,
      motionVideoUrl: exact.motionVideoUrl ?? null,
      motionCoverUrl: exact.motionCoverUrl ?? null,
      motionColors: exact.motionColors ?? null,
    };
  } catch {
    // 凭据缺失或上游异常都不该让整张卡片失败
    return {
      link: searchUrl,
      artwork: null,
      id: null,
      motionVideoUrl: null,
      motionCoverUrl: null,
      motionColors: null,
    };
  }
}
