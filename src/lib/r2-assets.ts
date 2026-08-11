import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/** 浏览器直接访问 R2；站点只保存对象键并组装公开 URL。 */
export const ASSET_URL_PREFIX = `${trimSlash(
  process.env.R2_PUBLIC_BASE_URL ?? "https://r2-not-configured.invalid",
)}/`;

let client: S3Client | null = null;
let warned = false;

function getR2(): { s3: S3Client; bucket: string } | null {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !process.env.R2_PUBLIC_BASE_URL) {
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

const confirmed = new Set<string>();

/** 上报器直传完成后，只确认对象存在；站点不读取、不压缩也不写图片字节。 */
export async function hasStoredImage(objectKey: string): Promise<boolean> {
  if (confirmed.has(objectKey)) return true;
  const r2 = getR2();
  if (!r2) return false;
  try {
    await r2.s3.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: objectKey }));
    confirmed.add(objectKey);
    return true;
  } catch {
    return false;
  }
}
