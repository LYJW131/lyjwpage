import { cacheLife } from "next/cache";
import sharp from "sharp";

import { site } from "@/lib/site";

/** 先拿够大的源图，各尺寸再往下缩，避免直接向 GitHub 要 32px 那档。 */
const SOURCE_PX = 512;

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
 * 2× 就是 128 —— 比源图的 512 小，缩得动。改组件尺寸时这个数要跟着改。
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
 * 最坏情况等于内联之前的行为。
 *
 * null 仍然缓存（不抛出去在外面接 —— 那等于每轮重新生成都再赌一次 8 秒超时），
 * 但只按 `minutes` 缓存、不跟着成功那份冻到下次部署：这一路和最近提交同一个
 * 形状，按 tag 失效重渲染时在本区域是冷的，撞上 GitHub 限流就会拿到 null，
 * 按 `max` 缓存等于让一次瞬时故障管到下次部署。
 */
export async function githubAvatarDataUri(): Promise<string | null> {
  "use cache";

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    const webp = await sharp(source)
      .resize(CARD_PX, CARD_PX, { fit: "cover" })
      .webp()
      .toBuffer();
    cacheLife("max");
    return `data:image/webp;base64,${webp.toString("base64")}`;
  } catch (error) {
    console.error(
      "[github-avatar] 内联失败，回退远端",
      error instanceof Error ? error.message : String(error),
    );
    cacheLife("minutes");
    return null;
  }
}

export async function githubAvatarPng(px: number): Promise<Uint8Array> {
  "use cache";

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    const png = await sharp(source).resize(px, px, { fit: "cover" }).png().toBuffer();
    cacheLife("max");
    return new Uint8Array(png);
  } catch (error) {
    console.error(
      "[github-avatar]",
      error instanceof Error ? error.message : String(error),
    );
    // 深色方块只是占位，别让它冻到下次部署 —— 下一轮再试一次。
    cacheLife("minutes");
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
