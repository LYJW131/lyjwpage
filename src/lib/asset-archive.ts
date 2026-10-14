export const ASSET_ARCHIVE_PREFIX = "site-assets/";

const ARCHIVED_ASSET_PATH = /^\/assets\/([A-Za-z0-9_-][A-Za-z0-9._-]*\.(js|css|woff2|woff|ttf|svg|png|jpe?g|webp|avif|gif|ico|json|wasm))$/;

const CONTENT_TYPES: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  ico: "image/x-icon",
  json: "application/json",
  wasm: "application/wasm",
};

export function archivedAssetKey(pathname: string): string | null {
  const match = ARCHIVED_ASSET_PATH.exec(pathname);
  return match ? `${ASSET_ARCHIVE_PREFIX}${match[1]}` : null;
}

export function archivedAssetContentType(fileName: string): string | null {
  const match = ARCHIVED_ASSET_PATH.exec(`/assets/${fileName}`);
  return match ? CONTENT_TYPES[match[2]] : null;
}
