/** 内容寻址的图片对象键：R2 里的文件名，也是页面上 `/img/<键>` 的最后一段。 */
export const IMAGE_OBJECT_KEY = /^[a-f0-9]{64}\.(?:png|webp|jpe?g)$/;

/**
 * 页面同源下的图片前缀。
 *
 * 图片地址不再烧任何交付域：SQLite 只存对象键，Worker 和站点都只把它拼成
 * `/img/<键>` 这条相对路径。谁去 R2 取原件由访客进来的那个域名的边缘决定 ——
 * `lyjw.me` 是 next.config 里的 rewrite（Vercel 边缘代理并按 R2 的 immutable
 * 头缓存，不进 Function）；`lyjw131.com` 是 ESA 按静态后缀缓存、回源到同一处。
 * 从前按部署各配一份 `R2_PUBLIC_BASE_URL` 的做法在「一份 HTML 服务两个域名」
 * 之后就分不出国内国外了，所以改成让路径同源、由边缘分流。
 *
 * 改这个前缀要同时改 next.config 的 rewrite 和 ESA 的缓存 / 回源规则。
 */
export const IMAGE_PATH_PREFIX = "/img";

/** 对象键 → 页面上用的同源路径。 */
export function publicAssetPath(objectKey: string): string {
  return `${IMAGE_PATH_PREFIX}/${objectKey}`;
}

/**
 * 从一条图片地址里取回对象键。认相对路径也认绝对地址（Worker 给的是前者，
 * 夹具或旧数据里可能是后者）：内容键固定在路径末段，其余一概不看。
 */
export function objectKeyFromAssetUrl(url: string): string | null {
  const objectKey = url.split(/[?#]/, 1)[0].split("/").pop();
  return objectKey && IMAGE_OBJECT_KEY.test(objectKey) ? objectKey : null;
}
