import { cacheLife } from "next/cache";
import sharp from "sharp";

import { FIRST_SCREEN_CACHE_LIFE } from "@/lib/first-screen";
import { site } from "@/lib/site";

const SOURCE_PX = 512;

async function fetchAvatar(url: URL): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    cache: "force-cache",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "image/*" },
  });
  if (!res.ok) {
    console.error("[github-avatar]", `HTTP ${res.status}`, url.pathname);
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

// use cache 在预渲染时抛错会使构建失败；失败返回 null 并短缓存，不能永久冻结。
async function githubAvatarSource(buildId: string): Promise<Uint8Array | null> {
  "use cache";

  const candidates = [
    `https://avatars.githubusercontent.com/u/${site.githubId}`,
    `https://avatars.githubusercontent.com/${site.githubLogin}`,
  ];
  for (const base of candidates) {
    const url = new URL(base);
    url.searchParams.set("s", String(SOURCE_PX));
    url.searchParams.set("b", buildId);
    try {
      const source = await fetchAvatar(url);
      if (source) {
        cacheLife("max");
        return source;
      }
    } catch (error) {
      console.error("[github-avatar]", error instanceof Error ? error.message : String(error), url.pathname);
    }
  }
  cacheLife(FIRST_SCREEN_CACHE_LIFE);
  return null;
}

const CARD_PX = 128;

export async function githubAvatarDataUri(): Promise<string | null> {
  "use cache";

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    if (!source) throw new Error("GitHub avatar unavailable");
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
    cacheLife(FIRST_SCREEN_CACHE_LIFE);
    return null;
  }
}

export async function githubAvatarPng(px: number): Promise<Uint8Array> {
  "use cache";

  const buildId = process.env.BUILD_TIME ?? process.env.COMMIT_SHA ?? "";
  try {
    const source = await githubAvatarSource(buildId);
    if (!source) throw new Error("GitHub avatar unavailable");
    const png = await sharp(source).resize(px, px, { fit: "cover" }).png().toBuffer();
    cacheLife("max");
    return new Uint8Array(png);
  } catch (error) {
    console.error(
      "[github-avatar]",
      error instanceof Error ? error.message : String(error),
    );
    // 深色方块只是占位，别让它冻到下次部署 —— 下一轮再试一次。
    cacheLife(FIRST_SCREEN_CACHE_LIFE);
    const fallback = await sharp({
      create: { width: px, height: px, channels: 3, background: "#1a1a1a" },
    })
      .png()
      .toBuffer();
    return new Uint8Array(fallback);
  }
}

export function pngResponse(png: Uint8Array, contentType: string): Response {
  const body = new ArrayBuffer(png.byteLength);
  new Uint8Array(body).set(png);
  return new Response(body, { headers: { "Content-Type": contentType } });
}
