import { createHash, createHmac } from "node:crypto";

import sharp from "sharp";

import { config } from "./config.js";

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function objectUrl(objectKey: string) {
  const path = [config.r2.bucket, objectKey]
    .map((part) => encodeURIComponent(part))
    .join("/");
  return new URL(`${config.r2.endpoint}/${path}`);
}

/**
 * 上报器一次完成缩放和 WebP 编码，再把最终字节直传 R2。
 * 对象键取最终 WebP 的 SHA-256，因此可以安全使用 immutable 缓存。
 */
export async function uploadImage(input: Buffer, maxHeight: number): Promise<string> {
  const body = await sharp(input, { animated: false })
    .rotate()
    .resize({ height: maxHeight, withoutEnlargement: true })
    .webp({ quality: 88 })
    .toBuffer();
  // 对象键和 SigV4 要的 payload hash 是同一个值，别把整份 WebP 哈希两遍
  const payloadHash = sha256(body);
  const objectKey = `${payloadHash}.webp`;
  const url = objectUrl(objectKey);
  const amzDate = timestamp();
  const shortDate = amzDate.slice(0, 8);
  const scope = `${shortDate}/auto/s3/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    "content-type:image/webp",
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n") + "\n";
  const canonicalRequest = [
    "PUT",
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`AWS4${config.r2.secretAccessKey}`, shortDate),
        "auto",
      ),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${config.r2.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 512);
    throw new Error(`R2 上传失败 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  return objectKey;
}
