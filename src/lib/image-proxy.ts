import { createCipheriv, createDecipheriv, createHmac, createHash } from "node:crypto";

/**
 * Emby 图片代理的地址编码。
 *
 * 图片走本站域名而不是 Emby 直链，这样：
 * - 不把 Emby 源站暴露给浏览器
 * - 页面套上 CDN 后图片也能一起被缓存
 *
 * 参数不能明文放在 URL 里 —— 那样任何人都能照着拼出 Emby 直链，
 * 代理就形同虚设。这里把 id/kind/tag/height 整体加密成一个不透明 token。
 */

/** Emby 的图片类型，只放行这几个，避免拼出意外的上游路径 */
export const IMAGE_KINDS = ["Primary", "Backdrop", "Thumb"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ImageParams = {
  id: string;
  kind: ImageKind;
  tag: string;
  height: number;
};

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function baseSecret() {
  // 没单独配就复用 Emby 的 key —— 它本来就是密钥，零配置即可工作。
  // 换 key 会让旧链接失效，但图片链接本来就随 image tag 变，没影响。
  const value = process.env.IMAGE_PROXY_SECRET || process.env.EMBY_API_KEY;
  if (!value) throw new Error("缺少 IMAGE_PROXY_SECRET 或 EMBY_API_KEY，无法生成图片链接");
  return value;
}

/** 加密和派生 IV 用两把不同的子密钥，别拿同一把干两件事 */
function keys() {
  const secret = baseSecret();
  return {
    encryption: createHash("sha256").update(`${secret}|emby-image|enc`).digest(),
    iv: createHash("sha256").update(`${secret}|emby-image|iv`).digest(),
  };
}

function serialize({ id, kind, tag, height }: ImageParams) {
  return `${id}|${kind}|${tag}|${height}`;
}

/**
 * IV 由明文推导，而不是随机生成。
 *
 * 随机 IV 会让同一张图每次渲染都得到不同的 URL，CDN 和浏览器缓存全部失效 ——
 * 而缓存正是做这个代理的目的。确定性 IV 让 URL 稳定。
 *
 * GCM 的 nonce 复用之所以危险，是「同一个 nonce 加密不同明文」；这里 nonce
 * 由明文哈希而来，相同明文必然得到相同 nonce、不同明文几乎不可能撞上，
 * 构造上就排除了那种情况。
 */
function deriveIv(plaintext: string, ivKey: Buffer) {
  return createHmac("sha256", ivKey).update(plaintext).digest().subarray(0, IV_LENGTH);
}

/** 生成前端用的代理地址 */
export function embyImageUrl(params: ImageParams): string {
  const { encryption, iv: ivKey } = keys();
  const plaintext = serialize(params);
  const iv = deriveIv(plaintext, ivKey);

  const cipher = createCipheriv(ALGORITHM, encryption, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const token = Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
  return `/api/image/emby/${token}`;
}

export type DecodeResult =
  | { ok: true; params: ImageParams }
  | { ok: false; reason: string };

/**
 * 解码 token。GCM 的 auth tag 同时承担了完整性校验，
 * 所以不需要另外附一个签名 —— 改一个字节就解不开。
 */
export function decodeImageToken(token: string): DecodeResult {
  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return { ok: false, reason: "无法解析的 token" };
  }

  if (raw.length <= IV_LENGTH + TAG_LENGTH) return { ok: false, reason: "token 长度不足" };

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);

  let plaintext: string;
  try {
    const decipher = createDecipheriv(ALGORITHM, keys().encryption, iv);
    decipher.setAuthTag(authTag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return { ok: false, reason: "token 校验失败" };
  }

  const [id, kind, tag, rawHeight] = plaintext.split("|");
  const height = Number(rawHeight);

  // token 是自己签发的，理论上不会不合法；这里仍然校验一遍，
  // 免得将来改了序列化格式却忘了这边
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return { ok: false, reason: "非法的 id" };
  if (!tag || !/^[A-Za-z0-9]+$/.test(tag)) return { ok: false, reason: "非法的 tag" };
  if (!IMAGE_KINDS.includes(kind as ImageKind)) return { ok: false, reason: "非法的 kind" };
  if (!Number.isInteger(height) || height < 1 || height > 2000) {
    return { ok: false, reason: "非法的高度" };
  }

  return { ok: true, params: { id, kind: kind as ImageKind, tag, height } };
}
