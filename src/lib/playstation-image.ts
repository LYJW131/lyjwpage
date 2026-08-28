/**
 * PSN 图床的现缩参数。
 *
 * 两个图床都认 `?w=&h=`：1024² 的封面要 336² 只回 25KB（浏览器带
 * `Accept: image/avif` 时它自己就编码成 AVIF），不带参数回的是 240KB 的原图。
 * 既然源站缩得动，按 AGENTS.md 那条规矩这一路就不进站点的图片管道 —— 绕回
 * `/_next/image` 只是多一次转码、多一份配额，还把本可以直连 CDN 的请求拽回
 * 自己的函数。EdgeOne 上更是白搭：它注入的 loader 追加的是 `imageMogr2`
 * 参数，PSN 不认，整张 1024² 原图照样落到浏览器里。
 *
 * 头像那个 psn-rsc 不认这两个参数（原样回 440² PNG），所以按主机名放行，
 * 认不出的原样返回。
 *
 * 只收一个正方边长：游玩列表和 presence 给的都是方形图标（实测 1024² / 512²），
 * 卡片上那一格也是方的。w 和 h 必须一起给 —— 只给 w 的话 CDN 会往上取到它
 * 自己那档预设尺寸（要 336 回 370），不是要的那个数。
 */
const SIZED_HOSTS = new Set([
  "image.api.playstation.com",
  "psnobj.prod.dl.playstation.net",
]);

export function playstationImage(
  url: string | null | undefined,
  size: number,
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // 判主机名而不是找子串，理由同 apple-artwork 的 needsOptimizing
  if (!SIZED_HOSTS.has(parsed.hostname)) return url;
  const dimension = String(Math.max(1, Math.round(size)));
  parsed.searchParams.set("w", dimension);
  parsed.searchParams.set("h", dimension);
  return parsed.toString();
}

/**
 * PSN 那几路图一律按 3 倍取，理由和 apple-artwork 的 ARTWORK_SCALE 一样：
 * 手机常见 3× DPR，2 倍图会被浏览器再放大一截而发虚。
 *
 * 直连那几路是拿它拼 `?w=&h=`；头像那路虽然走图片管道，取图目标也按它定
 *（报给 next/image 的是一半，好让 2x 那档正好落在 3 倍上，见 trophy-teaser）。
 *
 * 另一半理由是「差一点」比「差很多」还糊：从前那张交给优化器的 256px 图，
 * 落到 2× 屏上那格 224 个设备像素，浏览器还要再重采样一道 256 → 224，
 * 细节就是在这一步被抹掉的。现在按设备像素整数倍取，缩放只发生一次。
 */
export const PLAYSTATION_IMAGE_SCALE = 3;

/**
 * 奖杯图标（psnobj 那路）在 3 倍之上再多要一倍。
 *
 * 3 倍的像素数本身是够的（28 CSS × 3 = 84，服务端也真给 84），糊在**质量档**：
 * psnobj 对小尺寸吐的是压得很狠的 JPEG（84² 只有 ~4.5KB，而源图是 512² / 57KB），
 * 奖杯图案又是细节密的游戏原画，压缩痕迹在 3 倍屏上肉眼可见。要 6 倍（168²，
 * ~9KB）拿到的质量档高一截，浏览器降采样一道反而把细节收锐。只用于奖杯图标：
 * 游戏瓷砖那路 336² 的 AVIF 质量够、体积又大得多，不跟着加码。
 */
export const TROPHY_ICON_SCALE = PLAYSTATION_IMAGE_SCALE * 2;
