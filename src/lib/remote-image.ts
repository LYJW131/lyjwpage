import { PSN_SIZED_IMAGE_HOSTS } from "@shared/psn-image";
import { ImagePolicyError, allowedImageHost, fetchImageUpstream, parseImageSource, readImageBytes } from "@/lib/image-proxy";

// 卡片内联比公开的 /image 代理多认 PSN 带尺寸的图床与 Quest 封面（Discord 外链代理、Oculus 及其 CDN）；
// Discord 外链代理能转任意地址，不能进 /image 的白名单。
const CARD_EXACT_HOSTS = new Set([...PSN_SIZED_IMAGE_HOSTS, "media.discordapp.net", "www.oculus.com"]);

export function allowedCardImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowedImageHost(host) || CARD_EXACT_HOSTS.has(host) || host.endsWith(".oculuscdn.com");
}

export async function remoteImageDataUri(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const source = parseImageSource(raw, allowedCardImageHost);
  if (!source) throw new ImagePolicyError("source");
  const response = await fetchImageUpstream(source, fetchImpl, undefined, allowedCardImageHost);
  const bytes = await readImageBytes(response);
  const type = response.headers.get("Content-Type") ?? "application/octet-stream";
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
