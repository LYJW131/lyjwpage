/**
 * 上报器直传的那个桶在上报入口只做 HEAD：回执告诉上报器哪些图还没到。
 *
 * 公开地址不在这里拼：页面和状态 API 里的图片一律是 `/img/<键>` 这条同源路径
 * （见 `@/lib/asset-url`），由访客域名的边缘回源 R2，Worker 不需要知道交付域。
 */

/**
 * R2 桶里 prepare 用得着的那一点（HEAD）。根目录的 tsconfig 没有 Workers 类型，
 * 这里按形状声明；上报入口传 `env.IMAGES`，测试传替身。
 */
export interface ImageBucket {
  head(objectKey: string): Promise<unknown>;
}

/** HEAD 的正缓存要短：桶被清空后要能重新发现对象没了，否则会一直发指向已删对象的地址 */
const CONFIRMED_TTL_MS = 5 * 60_000;
const confirmed = new Map<string, number>();

/** Node 单测隔离正缓存；生产路径不调用。 */
export function resetStoredImageCacheForTests(): void {
  confirmed.clear();
}

export async function hasStoredImage(bucket: ImageBucket, objectKey: string): Promise<boolean> {
  const seenAt = confirmed.get(objectKey);
  if (seenAt != null && seenAt > Date.now()) return true;

  try {
    const head = await bucket.head(objectKey);
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
