import { IMAGE_PROXY_PATH, imageWidthBucket } from "@/lib/image-proxy";
import { playstationImage } from "@/lib/playstation-image";
import { stripScripts } from "@/lib/strip-scripts";
import type { SiteServices } from "@/server/site-context";
import type { StatusResponse } from "@shared/types";
import type { QuestNow } from "@shared/quest";

const unescapeAttribute = (value: string) =>
  value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// <img> 里的 SVG 不跑脚本、不取外部资源，内联脚本删掉，图片换成 data URI。
// 页面上走图片优化器的图（如 Apple Music 预签名封面）src 是同源的 `/image?url=…&w=<显示宽>`，出图时取回原图地址和宽度自己缩放。
function originalSource(src: string, width: number): [string, number] {
  if (!src.startsWith(`${IMAGE_PROXY_PATH}?`)) return [src, width];
  const params = new URLSearchParams(src.slice(IMAGE_PROXY_PATH.length + 1));
  return [params.get("url") ?? src, width || Number(params.get("w") ?? 0)];
}

// Discord 的外链代理把原图地址写在路径里（/external/<签名>/https/<原地址>）；代理拒绝 Worker 时退回原地址，只认 Meta 自家的 Quest 封面。
const discordExternalOrigin = (url: string) => {
  const path = /^https:\/\/media\.discordapp\.net\/external\/[^/]+\/https\/(www\.oculus\.com\/.+)$/.exec(url)?.[1];
  return path ? `https://${path}` : null;
};

export async function inlineQuestCover(site: SiteServices, quest: StatusResponse<QuestNow>): Promise<StatusResponse<QuestNow>> {
  const playing = quest.ok ? quest.data.playing : null;
  if (!quest.ok || !playing?.largeImageUrl) return quest;
  const origin = discordExternalOrigin(playing.largeImageUrl);
  const cover = (await site.asset(playing.largeImageUrl)) ?? (origin ? await site.asset(origin) : null);
  return { ...quest, data: { ...quest.data, playing: { ...playing, largeImageUrl: cover } } };
}

export async function inlineImages(html: string, site: SiteServices): Promise<string> {
  const widths = new Map<string, number>();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    const src = /\ssrc="([^"]+)"/.exec(tag)?.[1];
    if (!src || src.startsWith("data:")) continue;
    widths.set(src, Math.max(widths.get(src) ?? 0, Number(/\swidth="(\d+)"/.exec(tag)?.[1] ?? 0)));
  }
  // 封面原图常比显示尺寸大几倍：光栅图按显示宽度取 2 倍，PlayStation 图床自带缩放参数，其余走图片变体，取不到（不在白名单）再原样内嵌。
  const inlined = await Promise.all(
    [...widths].map(async ([src, shown]) => {
      const [url, width] = originalSource(unescapeAttribute(src), shown);
      const sized = width > 0 ? playstationImage(url, width * 2) : url;
      const resized =
        width > 0 && sized === url && !/\.svg(\?|$)/.test(url)
          ? await site.image(url, imageWidthBucket(width * 2), "scale-down")
          : null;
      return [src, resized ?? (await site.asset(sized ?? url))] as const;
    }),
  );
  // 卡片作为 <image> 套在外层里，WebKit 对异步解码或懒加载的图解完不重画，大图就一直空着；统一同步解码、不懒加载。
  let out = stripScripts(html)
    .replace(/\s(?:srcSet|loading|decoding)="[^"]*"/g, "")
    .replace(/<img\b/g, '<img decoding="sync"');
  for (const [src, data] of inlined) out = out.replaceAll(`"${src}"`, `"${data ?? ""}"`);
  return out;
}
