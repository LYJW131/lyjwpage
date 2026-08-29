/**
 * Apple Music 链接解析。纯函数，不碰网络 —— 和 apple-music-lookup 一样单拆
 * 一个文件，`node --test` 直接吃（测试跑在裸 node 下，解析不了 `@/` 别名，
 * 连着 lib/cache 那串依赖的模块进不了测试）。
 */

export interface AppleMusicParsed {
  storefront: string;
  albumId?: string;
  songId?: string;
}

const STOREFRONT_REGEX = /^[a-z]{2}$/;
/**
 * 目录里专辑 / 单曲的资源 ID 一律是纯数字（带字母前缀的 `i.xxx` 是资料库 ID，
 * 那种链接本来就解不出动态封面）。收紧到数字才算把「解析出的值要拼进 amp-api
 * 的 URL」这条路彻底钉死 —— storefront 有自己的两字母白名单，三个动态段就都
 * 不可能携带路径手术了。
 */
const RESOURCE_ID_REGEX = /^\d{1,20}$/;

export function parseAppleMusicUrl(rawUrl: string): AppleMusicParsed | null {
  try {
    const u = new URL(rawUrl);
    // 整段匹配主机名：光 endsWith('music.apple.com') 会放过 evilmusic.apple.com
    if (u.hostname !== "music.apple.com" && !u.hostname.endsWith(".music.apple.com")) {
      return null;
    }

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    let storefront = "us";
    let typeIndex = 0;

    const firstPart = parts[0];
    if (firstPart && STOREFRONT_REGEX.test(firstPart.toLowerCase())) {
      storefront = firstPart.toLowerCase();
      typeIndex = 1;
    }

    const type = parts[typeIndex];
    const lastId = parts[parts.length - 1];
    if (!lastId || !RESOURCE_ID_REGEX.test(lastId)) return null;

    if (type === "album") {
      return { storefront, albumId: lastId };
    } else if (type === "song") {
      return { storefront, songId: lastId };
    }

    return null;
  } catch {
    return null;
  }
}
