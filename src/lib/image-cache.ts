import { key as redisKey, withRedis } from "@/lib/redis";

/**
 * 图片的进程内缓存。
 *
 * 和 lib/cache.ts 分开：那个存的是小 JSON，条数有限；这里存的是二进制，
 * 必须自己管住条数和总字节数，否则 token 随 image tag 变化会无限堆积。
 *
 * 上界推算：续播列表 limit 8，每条会生成 poster + backdrop 两个地址，
 * 也就是最多 16 张不同的图。实测一张约 200KB，满打满算 3~4MB。
 * 这里按 2 倍留余量，够列表更替时新旧并存。
 */

const MAX_ENTRIES = 32;
/** 单张超过这个大小就不缓存了，直接透传，免得一张异常大图吃掉内存 */
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
/** 总量兜底，正常情况下摸不到 */
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
/** 不设太长：图片内容变了 token 也会变，缓存只是为了挡住重复回源 */
const TTL_MS = 10 * 60 * 1000;

export type ImageEntry = {
  body: Buffer;
  contentType: string;
  etag: string | null;
};

type StoredEntry = ImageEntry & { expiresAt: number };

// Map 保持插入顺序，命中时删掉重插即可实现 LRU
const store = new Map<string, StoredEntry>();
const inflight = new Map<string, Promise<ImageEntry | null>>();
let totalBytes = 0;

function drop(key: string) {
  const entry = store.get(key);
  if (!entry) return;
  totalBytes -= entry.body.byteLength;
  store.delete(key);
}

/** 从最久未使用的一端开始淘汰，直到条数和总量都回到限额内 */
function evict() {
  while (store.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    drop(oldest.value);
  }
}

function put(key: string, entry: ImageEntry) {
  if (entry.body.byteLength > MAX_ENTRY_BYTES) return;
  drop(key);
  store.set(key, { ...entry, expiresAt: Date.now() + TTL_MS });
  totalBytes += entry.body.byteLength;
  evict();
}

/** Redis 里存两个键：图片本体（二进制）和它的 content-type / etag */
async function readRedis(token: string): Promise<ImageEntry | null> {
  return withRedis(async (redis) => {
    const [body, meta] = await Promise.all([
      redis.getBuffer(redisKey("image", token)),
      redis.get(redisKey("image", token, "meta")),
    ]);
    if (!body || !meta) return null;
    const parsed = JSON.parse(meta) as { contentType: string; etag: string | null };
    return { body, contentType: parsed.contentType, etag: parsed.etag };
  }, null);
}

async function writeRedis(token: string, entry: ImageEntry) {
  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    pipe.set(redisKey("image", token), entry.body, "PX", TTL_MS);
    pipe.set(
      redisKey("image", token, "meta"),
      JSON.stringify({ contentType: entry.contentType, etag: entry.etag }),
      "PX",
      TTL_MS,
    );
    await pipe.exec();
    return null;
  }, null);
}

/**
 * 取图。同一个 key 并发进来只会真正回源一次 ——
 * 光有缓存不够，缓存刚过期那一瞬间的并发会同时穿透。
 *
 * 两级：进程内存挡住绝大多数请求（省掉每张图 200KB 的 Redis 往返），
 * Redis 让重启和多实例之间也能共享。
 *
 * loader 返回 null 表示这张不适合缓存（比如太大），此时不写缓存。
 */
export async function getCachedImage(
  key: string,
  loader: () => Promise<ImageEntry | null>,
): Promise<ImageEntry | null> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    // 命中后挪到队尾，标记为最近使用
    store.delete(key);
    store.set(key, hit);
    return hit;
  }
  if (hit) drop(key);

  const running = inflight.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const cached = await readRedis(key);
      if (cached) {
        put(key, cached);
        return cached;
      }

      const entry = await loader();
      if (entry) {
        put(key, entry);
        await writeRedis(key, entry);
      }
      return entry;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** 给诊断用 */
export function imageCacheStats() {
  return { entries: store.size, totalBytes, maxEntries: MAX_ENTRIES };
}
