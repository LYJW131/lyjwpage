export { appleArtwork } from "@shared/apple-artwork";

export const ARTWORK_SCALE = 3;

// 预签名链接不能改查询串；构建期环境变量必须使用完整字面量才能替换。
const SIGNED_IMAGE_OPTIMIZATION_ENABLED =
  process.env.PUBLIC_SIGNED_IMAGE_OPTIMIZATION !== "false";

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
