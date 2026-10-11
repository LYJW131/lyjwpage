import { objectKeyFromAssetUrl, publicAssetPath } from "@/lib/asset-url";
import type { SiteServices } from "@/server/site-context";

const ICON_PX = 56;

// 对象键是内容哈希，字节不变，变体可按内容寻址永久缓存。
export async function desktopIconDataUri(
  site: SiteServices,
  iconUrl: string | null,
): Promise<string | null> {
  const objectKey = iconUrl ? objectKeyFromAssetUrl(iconUrl) : null;
  if (!objectKey) return null;
  try {
    return await site.image(publicAssetPath(objectKey), ICON_PX, "contain");
  } catch {
    return null;
  }
}
