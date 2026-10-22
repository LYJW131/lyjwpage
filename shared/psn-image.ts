export const PSN_AVATAR_HOST = "psn-rsc.prod.dl.playstation.net";
export const PSN_SIZED_IMAGE_HOSTS: readonly string[] = [
  "image.api.playstation.com",
  "psnobj.prod.dl.playstation.net",
];

const PSN_IMAGE_HOSTS = new Set<string>([PSN_AVATAR_HOST, ...PSN_SIZED_IMAGE_HOSTS]);

// PSN 图床会返回 http URL，升级为 https 避免混合内容被拦；不是 PSN 图床的 https URL 一律置空。
export function psnImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.replace(/^http:\/\//i, "https://"));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return PSN_IMAGE_HOSTS.has(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
}
