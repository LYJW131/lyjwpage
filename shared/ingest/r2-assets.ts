export interface ImageBucket {
  head(objectKey: string): Promise<unknown>;
}

// 正缓存必须过期，否则桶清空后仍会确认已删除的对象。
const CONFIRMED_TTL_MS = 5 * 60_000;
const confirmed = new Map<string, number>();

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
