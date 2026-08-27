import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { assetUrl } from "@/lib/asset-url";

export { IMAGE_OBJECT_KEY } from "@/lib/asset-url";

/**
 * 当前部署用来公开读取图片的地址。
 *
 * 名字沿用 R2_PUBLIC_BASE_URL，但它只描述交付层：Vercel 可以填 R2 自定义域，
 * EdgeOne 可以填以 R2 为源站的 COS CDN。Redis 只存 objectKey，所以同一份状态
 * 会在读取时按各自部署的变量拼出不同域名。
 */
export function publicAssetUrl(objectKey: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  return base ? assetUrl(base, objectKey) : null;
}

let client: S3Client | null = null;
let warned = false;

function getR2(): { s3: S3Client; bucket: string } | null {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    if (!warned) {
      warned = true;
      console.error("[r2] 环境变量不全，图片对象校验已停用");
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
 * 上报器直传后写进来的对象键。
 *
 * 扩展名并存不是历史包袱：Mac 桌面图标用系统原生 PNG，充电头封面是 Anker
 * 源 JPEG 原样上传，Emby 上报器在 Node 里用 sharp 写成 WebP。都是「一次编码
 * 定终身」，站点只认键的形状，不关心是谁编的。
 *
 * 单独导出而不是各处抄一遍字面量：两个 ingest 各校验一次，抄第二遍就迟早分家。
 */
/**
 * 确认过存在的对象键，带过期。
 *
 * 只缓存肯定结果：对象是内容寻址的，存在这件事一旦成立就只可能被「删掉」推翻，
 * 而删除很罕见。但**不能永不过期** —— 手动清空桶之后，站点会拿着这份记忆继续
 * 发一堆指向已删对象的 URL，页面上全是 404 而系统毫不知情（实测踩过）。
 *
 * 不缓存否定结果：那正是补传要走的路，缓存它等于把自愈拖慢一个窗口。
 */
const CONFIRMED_TTL_MS = 5 * 60_000;
const confirmed = new Map<string, number>();

/**
 * 上报器直传完成后，只确认对象存在：**这条路**不读取、不压缩也不写图片字节。
 *
 * 站点唯一读字节的地方是首屏内联（见 lib/desktop-icon-inline）：按 objectKey
 * 取一次、压一次、缓存永续，压出来的副本只进 HTML。运行时浏览器仍直连 R2 原件，
 * 站点不代理图片流量，R2 上那份原件也一个字节没动。
 */
export async function hasStoredImage(objectKey: string): Promise<boolean> {
  const seenAt = confirmed.get(objectKey);
  if (seenAt != null && seenAt > Date.now()) return true;

  const r2 = getR2();
  if (!r2) return false;
  try {
    await r2.s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
    confirmed.set(objectKey, Date.now() + CONFIRMED_TTL_MS);
    return true;
  } catch {
    confirmed.delete(objectKey);
    return false;
  }
}
