import { get, put, remove } from "@/lib/cache";
import type { AppleMusicParsed } from "@/lib/motion-artwork-url";

/**
 * Apple Music 正方形动态封面（`motionDetailSquare`）解析。
 *
 * 从前是独立的 Cloudflare Worker（am-motion-artwork），现在收编进站点：
 * 浏览器改打同源的 `/api/motion-artwork`，少一个要单独部署、单独配
 * ALLOWED_ORIGINS 的部件。逻辑原样搬来 —— 用从 music.apple.com 网页 JS 里
 * 扒的 web token 打 amp-api，**不用** Mac 上报器推来的那份 MusicKit 凭据：
 * `editorialVideo` 是 amp-api 的扩展属性，公开目录 API 认不认它没有验证过，
 * 而扒来的 token 本来就一分钱凭据不用。
 *
 * 缓存从 Cloudflare 边缘缓存换成 lib/cache（Redis 为主、进程内存兜底），
 * TTL 沿用 Worker 的约定：**有**动态封面 24 小时，**确认没有** 1 小时 ——
 * 后者短是留给「专辑后来补了动态封面」的翻案窗口。上游出错不写缓存，
 * 只留 5 秒负缓存挡穿透。CDN 那层由路由的 Cache-Control 带（见
 * app/api/motion-artwork/route.ts）。
 */

/** 所有 JSON 响应共用这一个形状，调用方不用按状态码分路解析 */
export interface MotionResult {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
  error?: string;
}

/** 「查过了，没有动态封面」。要带 error 时展开它再补一个字段 */
export const NO_MOTION: MotionResult = { hasMotion: false, videoUrl: null, colors: null };

/** 上游（music.apple.com / amp-api）没给出正常回答。区别于「上游明确说没有」 */
class UpstreamError extends Error {}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
/**
 * 正在取 token 的那一次。
 *
 * cachedToken 是模块全局的（serverless 上即每实例一份），Redis 里另有一份
 * 全站共享的（见 loadWebToken）。in-flight 去重仍是进程内的：它挡的是
 * 冷启动后的一批并发请求各自把整个 JS bundle（几百 KB）扒一遍。
 */
let tokenInflight: Promise<string> | null = null;

/** Redis 里那份共享 web token 的键。两份生产各自的 Redis 各存一份 */
const TOKEN_CACHE_KEY = "motion-artwork:web-token";

type StoredToken = { token: string; expiresAt: number };

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 上游卡住时别把这次请求一起拖死 */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** 有动态封面的结论不会变，缓存久一点 */
const MOTION_TTL_MS = 24 * 60 * 60 * 1000;
/** 「确认没有」留个翻案窗口：专辑发行后补动态封面的事是有的 */
const NO_MOTION_TTL_MS = 60 * 60 * 1000;
/** 上游报错后，多久之内不再重试 */
const NEGATIVE_TTL_MS = 5_000;

const inflight = new Map<string, Promise<MotionResult>>();

/**
 * 解析一条已经 parse 过的 Apple Music 资源的动态封面。上游异常往上抛，
 * 由路由决定响应形状 —— 抛和「上游明确说没有」不能混成同一个 null。
 *
 * 没走 lib/cache 的 `cached()`：TTL 要按结论分档（有 24h / 没有 1h），
 * 而它一个键只吃一个 TTL。in-flight 去重和 5 秒负缓存照它那套自己搭。
 * 缓存键用解析后的身份而不是原始链接 —— 同一张专辑带不同查询串的链接
 * 该命中同一条。
 */
export async function resolveMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  const cacheKey = parsed.albumId
    ? `motion-artwork:v1:${parsed.storefront}:album:${parsed.albumId}`
    : `motion-artwork:v1:${parsed.storefront}:song:${parsed.songId}`;

  const [hit, failure] = await Promise.all([
    get<MotionResult>(cacheKey),
    get<{ message: string }>(`neg:${cacheKey}`),
  ]);
  if (hit !== undefined) return hit;
  if (failure) throw new UpstreamError(failure.message);

  const running = inflight.get(cacheKey);
  if (running) return running;

  const promise = (async () => {
    try {
      const result = await loadMotionArtwork(parsed);
      await put(cacheKey, result, result.hasMotion ? MOTION_TTL_MS : NO_MOTION_TTL_MS);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await put(`neg:${cacheKey}`, { message: err.message }, NEGATIVE_TTL_MS);
      throw err;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

async function loadMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  const token = await getWebToken();

  let albumId = parsed.albumId;
  // 若为独立 /song/ 链接，通过单曲元数据查找所属专辑 ID
  if (!albumId && parsed.songId) {
    albumId = (await fetchAlbumIdBySong(parsed.storefront, parsed.songId, token)) ?? undefined;
    if (!albumId) return NO_MOTION;
  }
  if (!albumId) return NO_MOTION;

  const motion = await fetchSquareMotionArtwork(parsed.storefront, albumId, token);
  if (!motion) return NO_MOTION;

  return { hasMotion: true, videoUrl: motion.videoUrl, colors: motion.colors };
}

async function getWebToken(): Promise<string> {
  // 刷新时刻已经定在半衰期（见 tokenRefreshAt），不再需要「提前 5 分钟」的边距
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  tokenInflight ??= loadWebToken().finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

/**
 * 先问 Redis，没有才真扒。
 *
 * token 有效期约半年，而扒取是这条链路最脆的一环 —— 从数据中心 IP 反复抓
 * music.apple.com 的页面和 JS bundle，Apple 哪天上验证页或改打包产物路径
 * 就断。共享进 Redis 后，全站扒取频率从「每个冷实例一次」降到「每个半衰期
 * 一次」。Redis 不可达时 get 返回 undefined，静默落回本实例自己扒 ——
 * token 读取失败不能把整个解析拖死，代价只是回到从前的每实例一扒。
 */
async function loadWebToken(): Promise<string> {
  const stored = await get<StoredToken>(TOKEN_CACHE_KEY);
  if (stored?.token && Date.now() < stored.expiresAt) {
    cachedToken = stored.token;
    tokenExpiresAt = stored.expiresAt;
    return stored.token;
  }

  const token = await scrapeWebToken();
  await put(TOKEN_CACHE_KEY, { token, expiresAt: tokenExpiresAt }, tokenExpiresAt - Date.now());
  return token;
}

/**
 * 从 music.apple.com 的 JS bundle 里扒一份 web token。
 *
 * 两次 fetch 都判 `.ok` 并把状态码写进错误里：上游返回 503 错误页时正则同样
 * 匹配不上，不判的话「Apple 改了打包产物路径」和「Apple 这会儿在抽风」会给出
 * 同一句 `No JS bundle`，排障时分不开。
 */
async function scrapeWebToken(): Promise<string> {
  const htmlResp = await fetch("https://music.apple.com", {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!htmlResp.ok) throw new UpstreamError(`music.apple.com ${htmlResp.status}`);
  const html = await htmlResp.text();
  const jsMatch = html.match(/\/assets\/index~[^"']+\.js/);
  if (!jsMatch) throw new UpstreamError("No JS bundle");

  const jsResp = await fetch("https://music.apple.com" + jsMatch[0], {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!jsResp.ok) throw new UpstreamError(`JS bundle ${jsResp.status}`);
  const jsContent = await jsResp.text();
  const jwtMatch = jsContent.match(/eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+/);
  if (!jwtMatch) throw new UpstreamError("No JWT");

  cachedToken = jwtMatch[0];
  tokenExpiresAt = tokenRefreshAt(parseJwtExp(cachedToken));
  return cachedToken;
}

/**
 * 刷新时刻定在 JWT 的半衰期：寿命过半就换新，永远不贴着过期线跑。
 * 解不出 exp 时 parseJwtExp 兜底 +24h，半衰期即 +12h。下限一小时 ——
 * 万一扒来的 token 的 exp 已在过去，别让它当场失效，否则每个请求都会
 * 重扒一遍同样的坏 token。
 */
function tokenRefreshAt(expMs: number): number {
  const now = Date.now();
  return now + Math.max((expMs - now) / 2, 60 * 60 * 1000);
}

function parseJwtExp(jwt: string): number {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2 || !parts[1]) return Date.now() + 24 * 60 * 60 * 1000;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (payload.exp && typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch {}
  return Date.now() + 24 * 60 * 60 * 1000;
}

/**
 * 打一次 amp-api。上游没给出正常回答就抛，别把它和「上游说没有」混成同一个 null。
 *
 * **401 清 token，但只清「挨了这记 401 的那份」。** 清本身是老教训：从前只有
 * `/album/` 那条路清，`/song/` 那条静默返回 null，token 一失效那条路会一直
 * 失败到 tokenExpiresAt 自然到期。带条件比对是 Redis 共享后补的：翻新窗口里
 * 拿旧 token 的请求还在天上飞，它们的迟到 401 若无条件清，会把别的实例刚扒好
 * 写进 Redis 的新 token（或本实例已翻新的全局）一并作废，害下一个冷实例白扒
 * 一遍。GET 和 DEL 之间残留毫秒级窗口，撞上的代价也只是多扒一次，不上锁。
 */
async function ampFetch<T>(endpoint: string, token: string): Promise<T> {
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      if (cachedToken === token) cachedToken = null;
      const stored = await get<StoredToken>(TOKEN_CACHE_KEY);
      if (stored?.token === token) await remove(TOKEN_CACHE_KEY);
    }
    throw new UpstreamError(`amp-api ${resp.status}`);
  }

  return (await resp.json()) as T;
}

async function fetchAlbumIdBySong(
  storefront: string,
  songId: string,
  token: string,
): Promise<string | null> {
  const json = await ampFetch<{
    data?: Array<{
      relationships?: {
        albums?: {
          data?: Array<{ id?: string }>;
        };
      };
    }>;
  }>(
    `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}?include=albums`,
    token,
  );
  return json?.data?.[0]?.relationships?.albums?.data?.[0]?.id ?? null;
}

interface EditorialVideoItem {
  video?: string;
  previewFrame?: {
    bgColor?: string;
    textColor1?: string;
    textColor2?: string;
    textColor3?: string;
    textColor4?: string;
  };
}

async function fetchSquareMotionArtwork(
  storefront: string,
  albumId: string,
  token: string,
): Promise<{ videoUrl: string; colors: string[] | null } | null> {
  const result = await ampFetch<{
    data?: Array<{
      attributes?: {
        editorialVideo?: {
          motionDetailSquare?: EditorialVideoItem;
          motionSquareVideo1x1?: EditorialVideoItem;
        };
      };
    }>;
  }>(
    `https://amp-api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?extend=editorialVideo`,
    token,
  );

  const videoData = result?.data?.[0]?.attributes?.editorialVideo;
  if (!videoData) return null;

  const squareClip = videoData.motionDetailSquare?.video
    ? videoData.motionDetailSquare
    : videoData.motionSquareVideo1x1;

  if (!squareClip?.video) return null;

  const pf = squareClip.previewFrame;
  const colors = pf
    ? ([pf.bgColor, pf.textColor1, pf.textColor2, pf.textColor3, pf.textColor4].filter(
        Boolean,
      ) as string[])
    : null;

  return {
    videoUrl: squareClip.video,
    colors: colors && colors.length > 0 ? colors : null,
  };
}
