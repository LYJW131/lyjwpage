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
