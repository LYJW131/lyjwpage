import { cacheLife } from "next/cache";
import sharp from "sharp";

import { objectKeyFromAssetUrl } from "@/lib/asset-url";
import { r2OriginUrl } from "@/lib/r2-assets";

const ICON_PX = 56;

// 对象键是内容哈希，字节不变，才允许永久缓存压缩结果。
async function inlineDesktopIcon(objectKey: string): Promise<string | null> {
  "use cache";
  cacheLife("max");

  try {
    const url = r2OriginUrl(objectKey);
    if (!url) return null;

    const res = await fetch(url, {
      cache: "force-cache",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) throw new Error(`R2 图标 HTTP ${res.status}`);

    const webp = await sharp(new Uint8Array(await res.arrayBuffer()))
      // sharp 默认背景不透明；contain 的留白必须显式设 alpha:0。
      .resize(ICON_PX, ICON_PX, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp()
      .toBuffer();

    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch (error) {
    console.error(
      "[desktop-icon] 内联失败，回退远端",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function desktopIconDataUri(iconUrl: string | null): Promise<string | null> {
  const objectKey = iconUrl ? objectKeyFromAssetUrl(iconUrl) : null;
  return objectKey ? inlineDesktopIcon(objectKey) : null;
}
