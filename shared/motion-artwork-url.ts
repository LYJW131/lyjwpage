
export interface AppleMusicParsed {
  storefront: string;
  albumId?: string;
  songId?: string;
}

const STOREFRONT_REGEX = /^[a-z]{2}$/;
// 资源 ID 会进入上游 URL 路径，必须限定数字，防止路径注入。
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
