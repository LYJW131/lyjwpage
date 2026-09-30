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

export const PLAYSTATION_IMAGE_SCALE = 3;

