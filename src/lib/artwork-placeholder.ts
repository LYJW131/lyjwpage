import { appleArtwork } from "@/lib/apple-artwork";
import type { SiteServices } from "@/server/site-context";

// 占位图不能改成 CSS 背景：背景解码时机不可控，会在移动端水合时露出空帧。

export const HERO_PLACEHOLDER_PX = 240;

export const ROW_PLACEHOLDER_PX = 88;

// 质量按档显式查表；列表档像素数大于 hero，不能按尺寸大小推导质量。
const QUALITY_BY_PX: Record<number, number> = {
  [HERO_PLACEHOLDER_PX]: 75,
  [ROW_PLACEHOLDER_PX]: 60,
};

async function encodePlaceholder(
  site: SiteServices,
  templateUrl: string,
  px: number,
): Promise<ArtworkDataUri | null> {
  try {
    let source: URL;
    try {
      source = new URL(templateUrl);
    } catch {
      return null;
    }
    if (
      source.protocol !== "https:" ||
      (!source.hostname.endsWith(".mzstatic.com") &&
        !source.hostname.endsWith(".blobstore.apple.com"))
    ) return null;

    const url = appleArtwork(templateUrl, px);
    if (!url) return null;

    const quality = QUALITY_BY_PX[px] ?? 50;
    const dataUri = await site.image(url, px, "cover", quality);
    return dataUri ? (dataUri as ArtworkDataUri) : null;
  } catch {
    return null;
  }
}

export type ArtworkDataUri = `data:image/${string}`;

export type ArtworkPlaceholders = {
  hero: Record<string, ArtworkDataUri>;
  rows: Record<string, ArtworkDataUri>;
};

async function encodeAll(
  site: SiteServices,
  urls: Iterable<string>,
  px: number,
): Promise<Record<string, ArtworkDataUri>> {
  const unique = [...new Set([...urls].filter(Boolean))];
  const encoded = await Promise.all(
    unique.map((url) => encodePlaceholder(site, url, px)),
  );

  const table: Record<string, ArtworkDataUri> = {};
  unique.forEach((url, i) => {
    const placeholder = encoded[i];
    if (placeholder) table[url] = placeholder;
  });
  return table;
}

// SSR 的 HTML 不区分设备，不能按移动端可见行数裁掉桌面首屏所需的占位图。
export async function artworkPlaceholders(
  site: SiteServices,
  rowArtworks: (string | null | undefined)[],
  heroArtwork: string | null | undefined,
): Promise<ArtworkPlaceholders> {
  const rows = rowArtworks.filter((url): url is string => Boolean(url));
  const heroes = heroArtwork ? [heroArtwork] : [];

  const [hero, rowTable] = await Promise.all([
    encodeAll(site, heroes, HERO_PLACEHOLDER_PX),
    encodeAll(site, rows, ROW_PLACEHOLDER_PX),
  ]);
  return { hero, rows: rowTable };
}
