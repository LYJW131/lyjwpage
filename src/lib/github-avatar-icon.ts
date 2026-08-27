import { cacheLife } from "next/cache";
import sharp from "sharp";

import { site } from "@/lib/site";

/** 先拿够大的源图，各尺寸再往下缩，避免直接向 GitHub 要 32px 那档。 */
const SOURCE_PX = 256;

/**
 * 构建期把 GitHub 头像焊进站点图标。
 *
 * `BUILD_TIME` 进缓存键：每次部署换一份，Vercel 的 fetch 缓存不会把旧头像
 * 一直复用。头像 CDN 不认多余的查询参数，`b=` 只为我们自己的缓存键服务。
 */
async function githubAvatarSource(buildId: string): Promise<Uint8Array> {
  "use cache";
  cacheLife("max");

  const url = new URL(`https://avatars.githubusercontent.com/${site.githubLogin}`);
  url.searchParams.set("s", String(SOURCE_PX));
  url.searchParams.set("b", buildId);

  const res = await fetch(url, {
    cache: "force-cache",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "image/*" },
  });
  if (!res.ok) {
    throw new Error(`GitHub avatar HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * 卡片上那张头像的展示尺寸 ×2。
 *
 * contact-card 的容器是 `size-14` / `lg:size-16`，`sizes` 也只声明到 64px，
 * 2× 就是 128 —— 比源图的 256 小，缩得动。改组件尺寸时这个数要跟着改。
 */
const CARD_PX = 128;

/**
 * 首屏那张头像，内联成 data URI 焊进 HTML。
 *
 * 图标那两路是外部请求，晚一点到没人看得见；卡片上这张在页面顶部，走
 * `/_next/image` 意味着「HTML 先到、头像后到」，顶部空一格。内联掉这一跳。
 *
 * 自己也带 `use cache`：首页是预渲染的静态壳，但每次上报按 tag 失效后会在
 * 服务端重新生成一遍，不缓存的话每轮都要重跑一次 sharp。
 *
 * 选 webp 不选 png：base64 会把体积再放大三分之一，这份要进每一份 HTML。
 *
 * 拉不到就返回 null，**不能**学 `githubAvatarPng` 回退成深色方块 —— 那是页面
 * 顶部可见的一张脸，糊成色块比慢一点糟得多。调用方拿到 null 回退到远端 URL，
 * 最坏情况等于内联之前的行为。null 会跟着 `cacheLife("max")` 一起冻到下次部署：
 * 这是有意的，改成抛出去、在缓存外面接，等于每轮重新生成都再赌一次 8 秒超时。
 */
export async function githubAvatarDataUri(): Promise<string | null> {
  "use cache";
  cacheLife("max");

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    const webp = await sharp(source)
      .resize(CARD_PX, CARD_PX, { fit: "cover" })
      .webp()
      .toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch (error) {
    console.error(
      "[github-avatar] 内联失败，回退远端",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function githubAvatarPng(px: number): Promise<Uint8Array> {
  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    const png = await sharp(source).resize(px, px, { fit: "cover" }).png().toBuffer();
    return new Uint8Array(png);
  } catch (error) {
    console.error(
      "[github-avatar]",
      error instanceof Error ? error.message : String(error),
    );
    const fallback = await sharp({
      create: { width: px, height: px, channels: 3, background: "#1a1a1a" },
    })
      .png()
      .toBuffer();
    return new Uint8Array(fallback);
  }
}

/** DOM 的 BodyInit 不认 `Uint8Array<ArrayBufferLike>`，拷成独立 ArrayBuffer 再交给 Response。 */
export function pngResponse(png: Uint8Array, contentType: string): Response {
  const body = new ArrayBuffer(png.byteLength);
  new Uint8Array(body).set(png);
  return new Response(body, { headers: { "Content-Type": contentType } });
}
