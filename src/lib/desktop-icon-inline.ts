import { objectKeyFromAssetUrl, publicAssetPath } from "@shared/asset-url";
import type { SiteServices } from "@/server/site-context";

const ICON_PX = 56;

export async function desktopIconDataUri(
  site: SiteServices,
  iconUrl: string | null,
): Promise<string | null> {
  const objectKey = iconUrl ? objectKeyFromAssetUrl(iconUrl) : null;
  return objectKey ? site.image(publicAssetPath(objectKey), ICON_PX, "contain") : null;
}
