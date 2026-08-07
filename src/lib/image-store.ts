import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { key as redisKey, withRedis } from "@/lib/redis";

/**
 * 所有由本站提供的图片都从这里进出。
 *
 * - L1 是有字节上限的进程内 LRU，挡住绝大多数二进制 Redis 往返。
 * - L2 是 Redis，供重启和多实例共享。
 * - 遥测上传的原图无法回源，因此额外写入唯一的本地持久目录；Emby 图可以
 *   随时回源，不重复落盘。
 */

const MAX_ENTRIES = 64;
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;
const STORED_IMAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORED_IMAGE_ID = /^[a-f0-9]{24}$/;

const IMAGE_STORE_DIR =
  process.env.IMAGE_STORE_DIR ?? join(tmpdir(), "lyjwpage-images-v1");

export type ImageEntry = {
  body: Buffer;
  contentType: string;
  etag: string | null;
};

type StoredEntry = ImageEntry & { expiresAt: number };

const memory = new Map<string, StoredEntry>();
const inflight = new Map<string, Promise<ImageEntry | null>>();
let totalBytes = 0;

function drop(key: string) {
  const entry = memory.get(key);
  if (!entry) return;
  totalBytes -= entry.body.byteLength;
  memory.delete(key);
}

function evict() {
  while (memory.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    drop(oldest.value);
  }
}

function remember(key: string, entry: ImageEntry, ttlMs: number) {
  if (entry.body.byteLength > MAX_ENTRY_BYTES) return;
  drop(key);
  memory.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
  totalBytes += entry.body.byteLength;
  evict();
}

function memoryGet(key: string) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    drop(key);
    return null;
  }

  memory.delete(key);
  memory.set(key, entry);
  return entry;
}

async function readRedis(key: string): Promise<ImageEntry | null> {
  return withRedis(async (redis) => {
    const [body, meta] = await Promise.all([
      redis.getBuffer(redisKey("image", key)),
      redis.get(redisKey("image", key, "meta")),
    ]);
    if (!body || !meta) return null;
    const parsed = JSON.parse(meta) as { contentType: string; etag: string | null };
    if (typeof parsed.contentType !== "string") return null;
    return { body, contentType: parsed.contentType, etag: parsed.etag ?? null };
  }, null);
}

async function writeRedis(key: string, entry: ImageEntry, ttlMs: number) {
  await withRedis(async (redis) => {
    const pipe = redis.pipeline();
    pipe.set(redisKey("image", key), entry.body, "PX", ttlMs);
    pipe.set(
      redisKey("image", key, "meta"),
      JSON.stringify({ contentType: entry.contentType, etag: entry.etag }),
      "PX",
      ttlMs,
    );
    await pipe.exec();
    return null;
  }, null);
}

async function loadImage(
  key: string,
  ttlMs: number,
  loader: () => Promise<ImageEntry | null>,
): Promise<ImageEntry | null> {
  const memoryHit = memoryGet(key);
  if (memoryHit) return memoryHit;

  const running = inflight.get(key);
  if (running) return running;

  const promise = (async () => {
    try {
      const redisHit = await readRedis(key);
      if (redisHit) {
        remember(key, redisHit, ttlMs);
        return redisHit;
      }

      const entry = await loader();
      if (entry) {
        remember(key, entry, ttlMs);
        if (entry.body.byteLength <= MAX_ENTRY_BYTES) {
          await writeRedis(key, entry, ttlMs);
        }
      }
      return entry;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** 同一个 key 并发回源时只执行一次 loader。 */
export function getCachedImage(
  key: string,
  loader: () => Promise<ImageEntry | null>,
) {
  return loadImage(`cache:${key}`, CACHE_TTL_MS, loader);
}

function detectedContentType(body: Buffer) {
  if (body[0] === 0xff && body[1] === 0xd8) return "image/jpeg";
  if (
    body[0] === 0x89 &&
    body[1] === 0x50 &&
    body[2] === 0x4e &&
    body[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

async function persistStoredImage(id: string, body: Buffer) {
  await mkdir(IMAGE_STORE_DIR, { recursive: true });
  const destination = join(IMAGE_STORE_DIR, id);
  const temporary = join(IMAGE_STORE_DIR, `.${id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, body);
  await rename(temporary, destination);
}

/**
 * 保存遥测上传的 base64 图片，返回内容寻址的统一图片 URL。
 * 同样的图片只会得到同一个 id，状态心跳无需重复携带二进制。
 */
export async function storeUploadedImage(value: unknown): Promise<string | null> {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_ENTRY_BYTES * 4) / 3) + 4
  ) {
    return null;
  }

  const body = Buffer.from(value, "base64");
  const contentType = detectedContentType(body);
  if (!body.length || body.length > MAX_ENTRY_BYTES || !contentType) return null;

  const id = createHash("sha256").update(body).digest("hex").slice(0, 24);
  const key = `stored:${id}`;
  const entry = { body, contentType, etag: `"${id}"` };

  await persistStoredImage(id, body);
  remember(key, entry, STORED_IMAGE_TTL_MS);
  await writeRedis(key, entry, STORED_IMAGE_TTL_MS);
  return `/api/image/asset/${id}`;
}

async function readStoredFile(id: string) {
  let body: Buffer;
  try {
    body = await readFile(join(IMAGE_STORE_DIR, id));
  } catch {
    return null;
  }

  const contentType = detectedContentType(body);
  if (!contentType || body.byteLength > MAX_ENTRY_BYTES) return null;
  return { body, contentType, etag: `"${id}"` };
}

export function getStoredImage(id: string) {
  if (!STORED_IMAGE_ID.test(id)) return Promise.resolve(null);
  return loadImage(`stored:${id}`, STORED_IMAGE_TTL_MS, () => readStoredFile(id));
}

export function imageStoreStats() {
  return { entries: memory.size, totalBytes, maxEntries: MAX_ENTRIES };
}
