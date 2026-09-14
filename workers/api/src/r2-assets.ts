import { currentContext } from "./runtime";

export { IMAGE_OBJECT_KEY } from "@/lib/asset-url";

/**
 * 上报器直传的那个桶在 Worker 这侧只做 HEAD：回执告诉上报器哪些图还没到。
 *
 * 公开地址不在这里拼：页面和状态 API 里的图片一律是 `/img/<键>` 这条同源路径
 * （见 `@/lib/asset-url`），由访客域名的边缘回源 R2，Worker 不需要知道交付域。
 */

/** HEAD 结果只记 5 分钟：桶被清空后要能重新发现对象没了，否则会一直发指向已删对象的地址 */
const CONFIRMED_TTL_MS = 5 * 60_000;
const confirmed = new Map<string, number>();

export async function hasStoredImage(objectKey: string): Promise<boolean> {
  const seenAt = confirmed.get(objectKey);
  if (seenAt != null && seenAt > Date.now()) return true;

  try {
    const head = await currentContext().env.IMAGES.head(objectKey);
    if (!head) {
      confirmed.delete(objectKey);
      return false;
    }
    confirmed.set(objectKey, Date.now() + CONFIRMED_TTL_MS);
    return true;
  } catch (error) {
    console.error("[r2]", error instanceof Error ? error.message : String(error));
    confirmed.delete(objectKey);
    return false;
  }
}
