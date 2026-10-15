export const ASSET_ARCHIVE_PREFIX = "site-assets/";
// 桶上 site-assets/ 有 30 天过期规则（docs/ops-facts.md），回填的历史文件放这个前缀下长期保留。
export const LEGACY_ASSET_PREFIX = "site-assets-legacy/";

const EXTENSIONS = "js|css|woff2|woff|ttf|svg|png|jpe?g|webp|avif|gif|ico|json|wasm";
const ARCHIVED_ASSET_PATH = new RegExp(`^\\/assets\\/([A-Za-z0-9_-][A-Za-z0-9._-]*\\.(${EXTENSIONS}))$`);
const NEXT_STATIC_PATH = new RegExp(`^\\/_next\\/static\\/(?:[A-Za-z0-9_-][A-Za-z0-9._~-]*\\/)*[A-Za-z0-9_-][A-Za-z0-9._~-]*\\.(${EXTENSIONS})$`);

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

export function legacyAssetKey(pathname: string): string | null {
  return ARCHIVED_ASSET_PATH.test(pathname) || NEXT_STATIC_PATH.test(pathname) ? `${LEGACY_ASSET_PREFIX}${pathname.slice(1)}` : null;
}

export function archivedAssetKeys(pathname: string): string[] {
  return [archivedAssetKey(pathname), legacyAssetKey(pathname)].filter((key): key is string => key !== null);
}

export const STALE_NEXT_RELOAD_KEY = "lyjw:stale-next-reload";
export const STALE_NEXT_COOLDOWN_MS = 60_000;
export const STALE_NEXT_FETCH_TIMEOUT_MS = 4_000;

// 只有 Vercel 时期的旧 HTML 会请求 /_next/static/：那时的部署多数已被 Vercel 删掉，文件找不回来，
// 构建时间又写进了 JS 文件名，重建也对不上。缺档的脚本换成这段：强制重取当前页面换掉 HTTP 缓存里的旧 HTML，再刷新。
// 同一标签冷却期内只刷一次，多个缺档脚本不会连环触发；会话存储读写不了就不刷，免得记不住冷却而刷成环。
// 重取挂住时到时也刷新，且只刷一次。
export const STALE_NEXT_SCRIPT =
  `(function(){if(navigator.onLine===false)return;var k=${JSON.stringify(STALE_NEXT_RELOAD_KEY)},n=Date.now(),g=false;` +
  `try{var l=Number(sessionStorage.getItem(k)||0);if(n-l>=0&&n-l<${STALE_NEXT_COOLDOWN_MS})return;` +
  `sessionStorage.setItem(k,String(n));if(sessionStorage.getItem(k)!==String(n))return}catch(e){return}` +
  `function go(){if(g)return;g=true;location.reload()}var t=setTimeout(go,${STALE_NEXT_FETCH_TIMEOUT_MS});` +
  `fetch(location.href,{cache:"reload",credentials:"same-origin"}).then(function(r){return r.text()})` +
  `.catch(function(){}).then(function(){clearTimeout(t);go()})})();`;

export function isStaleNextScript(pathname: string): boolean {
  return pathname.endsWith(".js") && NEXT_STATIC_PATH.test(pathname);
}
