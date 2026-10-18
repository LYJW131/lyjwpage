import { publicAssetPath } from "@shared/asset-url";
import type { ChargerPayload, StatusResponse } from "@shared/types";
import type { SiteServices } from "@/server/site-context";

// 显示 16px，按 3x DPR 压到 48px。
const ICON_PX = 48;

// /img/ 的懒加载请求要等布局与低优先级队列，图标赶不上首帧；内联进 loader 数据让首屏自带。
export async function inlineChargerIcon(
  site: SiteServices,
  charger: StatusResponse<ChargerPayload>,
): Promise<StatusResponse<ChargerPayload>> {
  const cover = charger.ok ? charger.data.cover : null;
  const iconObjectKey = cover?.iconObjectKey ?? null;
  const icon = iconObjectKey
    ? await site.image(publicAssetPath(iconObjectKey), ICON_PX, "contain")
    : null;
  if (!charger.ok || !cover || !icon) return charger;
  return {
    ...charger,
    data: { ...charger.data, cover: { ...cover, iconUrl: icon } },
  };
}
