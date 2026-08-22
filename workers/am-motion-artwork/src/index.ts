export interface Env {
  /** 逗号分隔的允许来源。和另外三个 worker 那份是同一个名单，见 wrangler.toml */
  ALLOWED_ORIGINS?: string;
}

interface AppleMusicParsed {
  storefront: string;
  albumId?: string;
  songId?: string;
}

/** 所有 JSON 响应共用这一个形状，调用方不用按状态码分路解析 */
interface MotionResult {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
  error?: string;
}

/** 「查过了，没有动态封面」。要带 error 时展开它再补一个字段 */
const NO_MOTION: MotionResult = { hasMotion: false, videoUrl: null, colors: null };

/** 上游（music.apple.com / amp-api）没给出正常回答。区别于「上游明确说没有」 */
class UpstreamError extends Error {}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
/**
 * 正在扒 token 的那一次。
 *
 * cachedToken 是模块全局的，但没有 in-flight 去重的话，冷启动后的一批并发请求
 * 会各自把整个 JS bundle（几百 KB）扒一遍。
 */
let tokenInflight: Promise<string> | null = null;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const STOREFRONT_REGEX = /^[a-z]{2}$/;

/** 上游卡住时别把这次请求一起拖死 */
const UPSTREAM_TIMEOUT_MS = 10_000;

const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/*
 * 下面这四个函数和 online-counter / live-push / musickit-token 那三个 worker
 * 逐字一样（workers/online-counter/src/index.ts），改一处记得同步另外三处。
 * —— 唯一的差别是引号：本文件通篇用单引号，那三份用双引号。
 *
 * 没抽成共享包是故意的：域名名单本来就得在每份 wrangler.toml 里各配一次，
 * 抽包省不掉那份重复，却要多一个包和一层依赖解析。
 */

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * 允许 `https://*.vercel.app` 这样的后缀通配。
 *
 * Vercel 的预览域名每次部署都换一个（`lyjwpage-<hash>-....vercel.app`），
 * 只做全等匹配的话，预览环境永远拿不到动态封面。
 *
 * 按 hostname 的后缀比，不是按字符串包含 —— 后者会把
 * `https://vercel.app.evil.com` 也放进来。
 */
function originMatches(origin: string, pattern: string): boolean {
  if (origin === pattern) return true;
  if (!pattern.includes('*')) return false;

  const wildcard = pattern.match(/^(https?:)\/\/\*\.(.+)$/);
  if (!wildcard) return false;
  const [, protocol, suffix] = wildcard;

  try {
    const url = new URL(origin);
    return url.protocol === protocol && url.hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

function isAllowedOriginValue(origin: string, allowed: string[]): boolean {
  if (LOCAL_ORIGIN_RE.test(origin)) return true;
  return allowed.some((pattern) => originMatches(origin, pattern));
}

/**
 * 没配 ALLOWED_ORIGINS 就不限制 —— `wrangler dev` 不配也要能跑，而 localhost
 * 本来就始终放行。**配了之后，不带 Origin 头一律拒绝**：浏览器发跨源 fetch 时
 * 一定带这个头，所以卡死它对真实访客零代价，却堵上了「curl 不带头就绕过白名单」
 * 这个口子。
 *
 * 这个 worker 从前是五个里唯一完全敞开的：谁都能拿
 * `?url=<任意 Apple Music 链接>` 当免费的目录代理用，烧的是本账号的请求配额
 * 和 CPU 时间。边缘缓存只在同一个 URL 重复时挡得住，换个 `?url=` 就绕开了。
 */
function isAllowedOrigin(request: Request, env: Env): boolean {
  const allowed = getAllowedOrigins(env);
  if (allowed.length === 0) return true;
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return isAllowedOriginValue(origin, allowed);
}

function getCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  const allowed = getAllowedOrigins(env);
  if (origin && (allowed.length === 0 || isAllowedOriginValue(origin, allowed))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  } else if (allowed.length === 0) {
    headers.set('Access-Control-Allow-Origin', '*');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // 这个端点不读任何自定义头，`*` 没有必要
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = getCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET') {
      return withCors(jsonResponse({ ...NO_MOTION, error: 'Only GET method is supported' }, 405), cors);
    }

    if (!isAllowedOrigin(request, env)) {
      return withCors(jsonResponse({ ...NO_MOTION, error: 'Origin not allowed' }, 403), cors);
    }

    const cache = caches.default;

    // 尝试读取边缘缓存
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      response.headers.set('X-Worker-Cache', 'HIT');
      return withCors(response, cors);
    }

    /** 写进边缘缓存再补 CORS 头 —— 缓存里那份必须是来源无关的，见 withCors */
    const store = (res: Response): Response => {
      res.headers.set('X-Worker-Cache', 'MISS');
      ctx.waitUntil(cache.put(request, res.clone()));
      return withCors(res, cors);
    };

    try {
      const requestUrl = new URL(request.url);
      const targetUrl = requestUrl.searchParams.get('url');

      if (!targetUrl) {
        return withCors(
          jsonResponse({ ...NO_MOTION, error: 'Missing "url" query parameter' }, 400),
          cors
        );
      }

      // 解析 URL（提取 Storefront 和 ID）
      const parsed = parseAppleMusicUrl(targetUrl);
      if (!parsed) {
        return withCors(jsonResponse({ ...NO_MOTION, error: 'Invalid Apple Music URL' }, 400), cors);
      }

      const token = await getWebToken();

      let albumId = parsed.albumId;
      // 若为独立 /song/ 链接，通过单曲元数据查找所属专辑 ID
      if (!albumId && parsed.songId) {
        albumId = (await fetchAlbumIdBySong(parsed.storefront, parsed.songId, token)) ?? undefined;
        if (!albumId) return store(jsonResponse(NO_MOTION, 200, 3600));
      }

      if (!albumId) {
        return withCors(jsonResponse(NO_MOTION, 200, 3600), cors);
      }

      // 请求 amp-api 获取 1:1 动态封面
      const motion = await fetchSquareMotionArtwork(parsed.storefront, albumId, token);
      if (!motion) return store(jsonResponse(NO_MOTION, 200, 3600));

      return store(
        jsonResponse({ hasMotion: true, videoUrl: motion.videoUrl, colors: motion.colors }, 200, 86400)
      );
    } catch (error) {
      /*
       * 日志一定要留。wrangler.toml 开了 observability，而这里从前连
       * console.error 都没有 —— getWebToken 抛的 `No JS bundle`（Apple 改了打包
       * 产物路径就会触发）、JSON 解析失败、任何运行时异常，线上一律表现为一个
       * 没有半点线索的 500。响应体保持通用形状，不把原文外带（照隔壁
       * musickit-token 的做法：错误原文只进 Worker 日志）。
       *
       * 这条路径**不写边缘缓存**：从前上游出错也走「没有动态封面」那一支，
       * 以 max-age=3600 存了下来，于是 token 早换好了、同一个 URL 一小时内
       * 还是拿不到正确答案。
       */
      console.error('[am-motion-artwork]', error);
      return withCors(jsonResponse(NO_MOTION, 500), cors);
    }
  },
};

export default worker;

function parseAppleMusicUrl(rawUrl: string): AppleMusicParsed | null {
  try {
    const u = new URL(rawUrl);
    // 整段匹配主机名：光 endsWith('music.apple.com') 会放过 evilmusic.apple.com
    if (u.hostname !== 'music.apple.com' && !u.hostname.endsWith('.music.apple.com')) {
      return null;
    }

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    let storefront = 'us';
    let typeIndex = 0;

    const firstPart = parts[0];
    if (firstPart && STOREFRONT_REGEX.test(firstPart.toLowerCase())) {
      storefront = firstPart.toLowerCase();
      typeIndex = 1;
    }

    const type = parts[typeIndex];
    const lastId = parts[parts.length - 1];
    if (!lastId) return null;

    if (type === 'album') {
      return { storefront, albumId: lastId };
    } else if (type === 'song') {
      return { storefront, songId: lastId };
    }

    return null;
  } catch {
    return null;
  }
}

async function getWebToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  tokenInflight ??= scrapeWebToken().finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

/**
 * 从 music.apple.com 的 JS bundle 里扒一份 web token。
 *
 * 两次 fetch 都判 `.ok` 并把状态码写进错误里：上游返回 503 错误页时正则同样
 * 匹配不上，不判的话「Apple 改了打包产物路径」和「Apple 这会儿在抽风」会给出
 * 同一句 `No JS bundle`，排障时分不开。
 */
async function scrapeWebToken(): Promise<string> {
  const htmlResp = await fetch('https://music.apple.com', {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!htmlResp.ok) throw new UpstreamError(`music.apple.com ${htmlResp.status}`);
  const html = await htmlResp.text();
  const jsMatch = html.match(/\/assets\/index~[^"']+\.js/);
  if (!jsMatch) throw new UpstreamError('No JS bundle');

  const jsResp = await fetch('https://music.apple.com' + jsMatch[0], {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!jsResp.ok) throw new UpstreamError(`JS bundle ${jsResp.status}`);
  const jsContent = await jsResp.text();
  const jwtMatch = jsContent.match(/eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+/);
  if (!jwtMatch) throw new UpstreamError('No JWT');

  cachedToken = jwtMatch[0];
  tokenExpiresAt = parseJwtExp(cachedToken);
  return cachedToken;
}

function parseJwtExp(jwt: string): number {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2 || !parts[1]) return Date.now() + 24 * 60 * 60 * 1000;
    const payloadBase64 = parts[1];
    const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload) as { exp?: number };
    if (payload.exp && typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {}
  return Date.now() + 24 * 60 * 60 * 1000;
}

/**
 * 打一次 amp-api。上游没给出正常回答就抛，别把它和「上游说没有」混成同一个 null。
 *
 * **401 一律清掉扒来的 token。** 从前只有 `/album/` 那条路清，`/song/` 那条
 * 静默返回 null，于是 token 一失效，该 isolate 上所有 `/song/` 请求都会一直失败
 * 到 tokenExpiresAt 自然到期（解不出 `exp` 时兜底 +24 小时），或者恰好来一个
 * `/album/` 请求替它清掉为止。
 */
async function ampFetch<T>(endpoint: string, token: string): Promise<T> {
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://music.apple.com',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!resp.ok) {
    if (resp.status === 401) cachedToken = null;
    throw new UpstreamError(`amp-api ${resp.status}`);
  }

  return (await resp.json()) as T;
}

async function fetchAlbumIdBySong(
  storefront: string,
  songId: string,
  token: string
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
    token
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
  token: string
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
    token
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
        Boolean
      ) as string[])
    : null;

  return {
    videoUrl: squareClip.video,
    colors: colors && colors.length > 0 ? colors : null,
  };
}

function jsonResponse(data: MotionResult, status = 200, cacheTtl = 0): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  headers.set(
    'Cache-Control',
    cacheTtl > 0
      ? `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
      : 'no-store, no-cache, must-revalidate'
  );

  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

/**
 * 把这次请求该带的 CORS 头补上。
 *
 * ACAO 从前是写死的 `*`，现在回显具体来源，所以**存进边缘缓存的那一份不能带
 * 这些头** —— 带着的话，`caches.default` 会把某一个来源的响应原样发给另一个
 * 来源（`Vary: Origin` 只在还没进缓存时救得了自己）。顺序是先 `cache.put`
 * 再走这里。
 */
function withCors(response: Response, cors: Headers): Response {
  cors.forEach((value, key) => response.headers.set(key, value));
  return response;
}
