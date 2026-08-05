import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Emby 图片代理的签名。
 *
 * 图片走本站域名而不是 Emby 直链，这样：
 * - 不把 Emby 源站地址暴露给浏览器
 * - 页面套上 CDN 后图片也能一起被缓存
 *
 * 参数只有 id/kind/tag/h 四个，源站地址固定取自环境变量，所以不存在
 * 打到任意地址的问题；签名要挡的是「拿这个端点枚举你 Emby 里的条目」。
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

function secret() {
  // 没单独配就复用 Emby 的 key —— 它本来就是密钥，零配置即可工作。
  // 换 key 会让旧链接失效，但图片链接本来就是随 tag 变的，没影响。
  const value = process.env.IMAGE_PROXY_SECRET || process.env.EMBY_API_KEY;
  if (!value) throw new Error("缺少 IMAGE_PROXY_SECRET 或 EMBY_API_KEY，无法签名图片链接");
  return value;
}

function canonical({ id, kind, tag, height }: ImageParams) {
  return `${id}|${kind}|${tag}|${height}`;
}

/** 截断到 16 个十六进制字符（64 bit）—— 够挡枚举，又不会让 URL 太长 */
function sign(params: ImageParams) {
  return createHmac("sha256", secret()).update(canonical(params)).digest("hex").slice(0, 16);
}

/** 生成前端用的代理地址 */
export function embyImageUrl(params: ImageParams): string {
  const query = new URLSearchParams({
    id: params.id,
    kind: params.kind,
    tag: params.tag,
    h: String(params.height),
    s: sign(params),
  });
  return `/api/image/emby?${query}`;
}

export type VerifyResult =
  | { ok: true; params: ImageParams }
  | { ok: false; reason: string };

/** 校验请求参数，顺带把类型收窄 */
export function verifyImageRequest(search: URLSearchParams): VerifyResult {
  const id = search.get("id") ?? "";
  const kind = search.get("kind") ?? "";
  const tag = search.get("tag") ?? "";
  const height = Number(search.get("h"));
  const signature = search.get("s") ?? "";

  // 先做形状校验：id / tag 只可能是字母数字，杜绝往上游路径里塞 ../
  if (!/^[A-Za-z0-9]+$/.test(id)) return { ok: false, reason: "非法的 id" };
  if (!/^[A-Za-z0-9]+$/.test(tag)) return { ok: false, reason: "非法的 tag" };
  if (!IMAGE_KINDS.includes(kind as ImageKind)) return { ok: false, reason: "非法的 kind" };
  if (!Number.isInteger(height) || height < 1 || height > 2000) {
    return { ok: false, reason: "非法的高度" };
  }

  const params: ImageParams = { id, kind: kind as ImageKind, tag, height };
  const expected = sign(params);

  // 长度不等时 timingSafeEqual 会抛，先挡一道
  if (signature.length !== expected.length) return { ok: false, reason: "签名不匹配" };
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, reason: "签名不匹配" };
  }

  return { ok: true, params };
}
