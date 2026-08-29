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
    if (!lastId) return null;

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
