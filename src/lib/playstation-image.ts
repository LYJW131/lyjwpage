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
  if (!SIZED_HOSTS.has(parsed.hostname)) return url;
  const dimension = String(Math.max(1, Math.round(size)));
  parsed.searchParams.set("w", dimension);
  parsed.searchParams.set("h", dimension);
  return parsed.toString();
}

const AVATAR_HOST = "psn-rsc.prod.dl.playstation.net";

const AVATAR_FILE = /_(xl|l|m|s)(\.[a-z0-9]+)$/i;

// psn-rsc 不认 w/h，尺寸在文件名后缀。边长是各档实际像素；只降到不小于目标的最小一档，不往上改，缺档会 404。
const AVATAR_EDGE_PX = {
  s: 50,
  m: 160,
  l: 240,
  xl: 440,
} as const;

type AvatarSize = keyof typeof AVATAR_EDGE_PX;

const AVATAR_SIZES: AvatarSize[] = ["s", "m", "l", "xl"];

function avatarSizeFor(px: number): AvatarSize {
  return AVATAR_SIZES.find((size) => AVATAR_EDGE_PX[size] >= px) ?? "xl";
}

export function playstationAvatar(
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
  if (parsed.hostname !== AVATAR_HOST) return url;
  const match = parsed.pathname.match(AVATAR_FILE);
  if (!match) return url;
  const current = match[1].toLowerCase() as AvatarSize;
  const target = avatarSizeFor(size);
  if (AVATAR_EDGE_PX[current] <= AVATAR_EDGE_PX[target]) return url;
  parsed.pathname = parsed.pathname.replace(AVATAR_FILE, `_${target}${match[2]}`);
  return parsed.toString();
}

export function playstationAvatarNeedsOptimizing(
  url: string | null | undefined,
  size: number,
): boolean {
  const sized = playstationAvatar(url, size);
  if (!url || !sized || sized !== url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== AVATAR_HOST) return false;
    return !AVATAR_FILE.test(parsed.pathname);
  } catch {
    return false;
  }
}

export const PLAYSTATION_IMAGE_SCALE = 3;
