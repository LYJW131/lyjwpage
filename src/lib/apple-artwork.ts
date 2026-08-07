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

/** 位图按 2 倍取，Retina 上才不糊；再高在这些尺寸下肉眼已经看不出差别 */
export const ARTWORK_SCALE = 2;
