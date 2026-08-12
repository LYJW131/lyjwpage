/**
 * Apple Music CDN 封面模板 URL 的尺寸替换。
 *
 * 目录接口给的是带占位的模板（`.../{w}x{h}{c}.{f}`），真正的尺寸由取图的人填。
 * 所以服务端**原样透传**，不在那边定死一个尺寸 —— 它不知道每个位置要多大，
 * 从前统一填 600，结果 36px 的列表缩略图也在下 600px 的图。
 *
 * 不带占位的 URL 原样返回：本机上报的封面、走图片代理的自建歌单封面都是
 * 具体地址，调用方不必先判断这是哪一种。
 */
export function appleArtwork(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const dimension = Math.max(1, Math.round(size));
  return url
    .replace(/\{w\}/g, String(dimension))
    .replace(/\{h\}/g, String(dimension))
    // 资料库那边的模板还带 {f}（格式）和 {c}（裁剪方式）
    .replace(/\{f\}/g, "jpg")
    .replace(/\{c\}/g, "sr");
}

/**
 * Apple CDN 直链按 3 倍取：手机常见 3× DPR，2 倍图会被浏览器再放大一截而发虚。
 * 最大那张 hero 也只有 80px，取 240px 仍然足够小；不带尺寸模板的封面不受影响。
 */
export const ARTWORK_SCALE = 3;

/**
 * 预签名封面是否交给部署平台的图片优化器。
 *
 * Vercel 通过自己的 `/_next/image` 原样回源，默认开启没有问题。EdgeOne 注入的
 * loader 会直接在 Apple URL 后追加 `imageMogr2` 参数；而 AWS SigV4 把查询串也
 * 算进签名，多一个参数就会验签失败。EdgeOne 因此在构建环境里把这个变量设成
 * `false`，让 `next/image` 原样输出源地址。写成完整的 `process.env.XXX` 字面量，
 * Next 才能在客户端构建时替换它。
 */
const SIGNED_IMAGE_OPTIMIZATION_ENABLED =
  process.env.NEXT_PUBLIC_SIGNED_IMAGE_OPTIMIZATION !== "false";

/**
 * 这张图要不要过 Next 的图片优化。
 *
 * 全站只有自建歌单封面需要：Apple 给的是 blobstore 上的**原图**地址
 * （实测 274KB PNG），既没有 `{w}x{h}` 占位可填，也没法要小图，只能由站点
 * 这侧缩一道。放行的来源见 next.config.ts 的 remotePatterns。
 *
 * 其余一律不优化 —— 目录封面自带尺寸模板、R2 上的是上报器压好的最终尺寸且
 * 带 immutable，再送进优化器只是多一次转码、多一份配额，还把本来直连 CDN 的
 * 请求绕回自己的函数。
 *
 * 部署平台若不能保持预签名 URL 原样，则由上面的环境变量把这类图也切成直连。
 */
export function needsOptimizing(url: string | null | undefined): boolean {
  return (
    SIGNED_IMAGE_OPTIMIZATION_ENABLED &&
    Boolean(url?.includes(".blobstore.apple.com/"))
  );
}
