import sharp from "sharp";

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

/**
 * 存进缓存前把图压小。
 *
 * 用户上传的自定义封面动辄 1179×1179 / 270KB，而页面上最大的展示窗口也就
 * 80px。压在入口做而不是出口：缓存里存的直接就是小图，之后每次命中都省，
 * 地址也还是我们自己的 /api/image/...，不引入第二层缓存和第二套地址。
 *
 * maxDimension 按用途给 —— 歌单封面和 Emby 海报的展示尺寸差好几倍，
 * 一刀切要么糊要么白存。
 *
 * 尽力而为：sharp 处理不了的（动图、异常编码）原样返回，不让整条链路失败。
 */
async function compress(entry: ImageEntry, maxDimension: number): Promise<ImageEntry> {
  try {
    const image = sharp(entry.body, { animated: false });
    const meta = await image.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (!longest) return entry;

    const body = await image
      // withoutEnlargement：本来就比目标小的不要放大，白白变糊还变大
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    // 极少数情况下重编码反而更大（本来就是高压缩的小图），那就留原样
    if (body.byteLength >= entry.body.byteLength) return entry;
    return { body, contentType: "image/webp", etag: entry.etag };
  } catch (error) {
    console.error(
      "[image] 压缩失败，按原样缓存：",
      error instanceof Error ? error.message : String(error),
    );
    return entry;
  }
}

async function loadImage(
  key: string,
  ttlMs: number,
  loader: () => Promise<ImageEntry | null>,
  maxDimension?: number,
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

      const raw = await loader();
      const entry = raw && maxDimension ? await compress(raw, maxDimension) : raw;
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
  /** 最长边压到这个像素；省略则原样缓存 */
  maxDimension?: number,
) {
  return loadImage(`cache:${key}`, CACHE_TTL_MS, loader, maxDimension);
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
  return `${ASSET_URL_PREFIX}${id}`;
}

/**
 * 存下来的图片的 URL 前缀。
 *
 * 导出是给「丢弃旧格式 URL」用的：这些 URL 会随遥测状态持久化，前缀一旦改过，
 * 存量的那些就永远指向一个已经不存在的路由。别把这个字面量抄到第二处。
 */
export const ASSET_URL_PREFIX = "/api/image/asset/";

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
