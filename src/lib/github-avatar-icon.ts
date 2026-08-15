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
