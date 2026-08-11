import { createHash } from "node:crypto";

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

/**
 * 所有推进来的图片经这里压缩、按内容哈希写入 R2，状态里只存最终的公开 URL。
 *
 * 站点自己没有读路径：浏览器直连 R2 的公开域名取图，字节不经过任何路由。
 * 从前的三层缓存（进程内 LRU / Redis 二进制 / 本地磁盘）为的都是「站点要把
 * 字节吐给浏览器」，读路径没了它们就整个没了存在理由 —— Redis 里也不再放
 * 任何图片二进制，那是无服务器部署下最贵的存量。
 */

/**
 * WebP 默认质量。
 *
 * 这一档是按小图定的（歌单封面 240px、应用图标 96px），在那个尺寸上看不出来。
 * 展示尺寸大的（Emby 海报能到 237 CSS px、Retina 上 474）要单独往上调，
 * 否则细节会被吃掉 —— 实测 480px + 82 已经肉眼可见地劣化。
 */
const DEFAULT_WEBP_QUALITY = 82;

const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/**
 * 存下来的图片的 URL 前缀。
 *
 * 导出是给「丢弃旧格式 URL」用的（见 telemetry 的 keepFreshAsset）：这些 URL
 * 会随遥测状态持久化，前缀一旦改过，存量的那些就永远指向不存在的地方，靠
 * startsWith 这一道校验在恢复时把它们清掉、等下一次推送重新补上。
 *
 * 没配 R2 时给一个不可能被任何真实 URL 匹配到的占位前缀，而不是空串 ——
 * 空串会让 startsWith 放行一切，校验形同虚设。
 */
export const ASSET_URL_PREFIX = `${trimSlash(
  process.env.R2_PUBLIC_BASE_URL ?? "https://r2-not-configured.invalid",
)}/`;

let client: S3Client | null = null;
let warned = false;

/** R2 没配就整条链路安静降级：图片存不了，但状态本身照常流转 */
function getR2(): { s3: S3Client; bucket: string } | null {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !process.env.R2_PUBLIC_BASE_URL) {
    if (!warned) {
      warned = true;
      console.error("[image] R2 环境变量不全，图片存储已停用");
    }
    return null;
  }
  client ??= new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { s3: client, bucket };
}

/**
 * 本进程已确认存在于 R2 的对象。
 *
 * 内容寻址的对象不可变，「存在」这个事实一旦成立就永远成立，所以可以放心地
 * 在进程内记住，把同一张图反复推送时的 HEAD 往返省掉。进程重启丢了也无妨，
 * 代价只是每张图多一次 HEAD。
 */
const uploaded = new Set<string>();

type ImageEntry = {
  body: Buffer;
  contentType: string;
};

/**
 * 存进 R2 前把图压小。
 *
 * 上传的自定义封面动辄 1179×1179 / 270KB，而页面上最大的展示窗口也就 80px。
 * 压在入口做：R2 里存的直接就是小图，浏览器每次取图都省。
 *
 * maxDimension 按用途给 —— 歌单封面和 Emby 海报的展示尺寸差好几倍，
 * 一刀切要么糊要么白存。
 *
 * 尽力而为：sharp 处理不了的（动图、异常编码）原样返回，不让整条链路失败。
 */
async function compress(
  entry: ImageEntry,
  maxDimension: number,
  quality: number,
): Promise<ImageEntry> {
  try {
    const image = sharp(entry.body, { animated: false });
    const meta = await image.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (!longest) return entry;

    const body = await image
      // withoutEnlargement：本来就比目标小的不要放大，白白变糊还变大
      .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    // 极少数情况下重编码反而更大（本来就是高压缩的小图），那就留原样
    if (body.byteLength >= entry.body.byteLength) return entry;
    return { body, contentType: "image/webp" };
  } catch (error) {
    console.error(
      "[image] 压缩失败，按原样存储：",
      error instanceof Error ? error.message : String(error),
    );
    return entry;
  }
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
  // RIFF....WEBP —— 压缩输出就是这个格式，不认的话会被当成非法内容丢掉
  if (
    body.length >= 12 &&
    body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * 按内容哈希存一张图，返回稳定的公开地址。
 *
 * 地址取自压缩**之后**的字节，所以它就是内容指纹：图变了地址跟着变，
 * 对象配 `Cache-Control: immutable` 才站得住 —— 用歌单 id 之类的稳定标识做
 * 地址的话，换了封面地址不变，浏览器会一直拿着旧的那张。
 *
 * 同 id 的对象内容必然相同，已存在就跳过上传（先查进程内记录，再 HEAD）。
 */
export async function storeImageBuffer(
  input: Buffer,
  /** 最长边压到这个像素；省略则原样存 */
  maxDimension?: number,
  quality: number = DEFAULT_WEBP_QUALITY,
): Promise<string | null> {
  const r2 = getR2();
  const detected = detectedContentType(input);
  if (!r2 || !input.length || input.length > MAX_ENTRY_BYTES || !detected) return null;

  const entry = maxDimension
    ? await compress({ body: input, contentType: detected }, maxDimension, quality)
    : { body: input, contentType: detected };

  const id = createHash("sha256").update(entry.body).digest("hex").slice(0, 24);
  const url = `${ASSET_URL_PREFIX}${id}`;
  if (uploaded.has(id)) return url;

  try {
    try {
      await r2.s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: id }));
    } catch {
      await r2.s3.send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: id,
          Body: entry.body,
          ContentType: entry.contentType,
          // 内容寻址 = 不可变，让浏览器和 CDN 边缘放心缓存一年
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }
    uploaded.add(id);
    return url;
  } catch (error) {
    // R2 抖一下不该让整条上报链路失败；这张图等下一次推送再试
    console.error("[image] R2 写入失败：", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function storeUploadedImage(
  value: unknown,
  /** 最长边压到这个像素；省略则原样存 */
  maxDimension?: number,
  quality?: number,
): Promise<string | null> {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_ENTRY_BYTES * 4) / 3) + 4
  ) {
    return null;
  }
  return storeImageBuffer(Buffer.from(value, "base64"), maxDimension, quality);
}
