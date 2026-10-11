import sharp from "sharp";

import { site } from "@/lib/site";

const SOURCE_PX = 512;

async function fetchAvatar(url: URL): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "image/*" },
  });
  if (!res.ok) {
    console.error("[github-avatar]", `HTTP ${res.status}`, url.pathname);
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function githubAvatarSource(buildId: string): Promise<Uint8Array | null> {
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
      if (source) return source;
    } catch (error) {
      console.error("[github-avatar]", error instanceof Error ? error.message : String(error), url.pathname);
    }
  }
  return null;
}

const CARD_PX = 128;

export async function githubAvatarDataUri(source: Uint8Array | null): Promise<string | null> {
  if (!source) return null;
  try {
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

export async function githubAvatarPng(
  source: Uint8Array | null,
  px: number,
): Promise<Uint8Array> {
  if (source) {
    try {
      const png = await sharp(source).resize(px, px, { fit: "cover" }).png().toBuffer();
      return new Uint8Array(png);
    } catch (error) {
      console.error(
        "[github-avatar]",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const fallback = await sharp({
    create: { width: px, height: px, channels: 3, background: "#1a1a1a" },
  })
    .png()
    .toBuffer();
  return new Uint8Array(fallback);
}
