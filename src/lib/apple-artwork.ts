export function appleArtwork(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const dimension = Math.max(1, Math.round(size));
  return url
    // 只改尺寸模板这一段最后的输出后缀。前一段经常是源文件名（.jpg/.png），
    // 改它既没用还会让 Apple CDN 找不到原图；无占位的签名链接也不会命中。
    .replace(/(\/\{w\}x\{h\}[^/?]*\.)jpe?g(?=[?#]|$)/gi, "$1webp")
    .replace(/\{w\}/g, String(dimension))
    .replace(/\{h\}/g, String(dimension))
    .replace(/\{f\}/g, "webp")
    .replace(/\{c\}/g, "sr");
}

export const ARTWORK_SCALE = 3;

// 预签名链接不能改查询串；构建期环境变量必须使用完整字面量才能替换。
const SIGNED_IMAGE_OPTIMIZATION_ENABLED =
  process.env.NEXT_PUBLIC_SIGNED_IMAGE_OPTIMIZATION !== "false";

export function needsOptimizing(url: string | null | undefined): boolean {
  if (!SIGNED_IMAGE_OPTIMIZATION_ENABLED || !url) return false;
  // 判主机名而不是找子串：子串在路径里也能出现，随便一个
  // `https://evil.example/x.blobstore.apple.com/` 就能把自己塞进优化管道
  try {
    return new URL(url).hostname.endsWith(".blobstore.apple.com");
  } catch {
    return false;
  }
}
