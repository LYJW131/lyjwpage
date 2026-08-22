interface AppleMusicParsed {
  storefront: string;
  albumId?: string;
  songId?: string;
}

interface MotionResult {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
  error?: string;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const STOREFRONT_REGEX = /^[a-z]{2}$/;

const worker = {
  async fetch(
    request: Request,
    _env: Record<string, unknown>,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Only GET method is supported' }, 405);
    }

    const cache = caches.default;

    // 尝试读取边缘缓存
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      const response = new Response(cachedResponse.body, cachedResponse);
      response.headers.set('X-Worker-Cache', 'HIT');
      return response;
    }

    try {
      const requestUrl = new URL(request.url);
      const targetUrl = requestUrl.searchParams.get('url');

      if (!targetUrl) {
        return jsonResponse(
          { hasMotion: false, videoUrl: null, colors: null, error: 'Missing "url" query parameter' },
          400
        );
      }

      // 解析 URL（提取 Storefront 和 ID）
      const parsed = parseAppleMusicUrl(targetUrl);
      if (!parsed) {
        return jsonResponse(
          { hasMotion: false, videoUrl: null, colors: null, error: 'Invalid Apple Music URL' },
          400
        );
      }

      const token = await getWebToken();

      let albumId = parsed.albumId;
      // 若为独立 /song/ 链接，通过单曲元数据查找所属专辑 ID
      if (!albumId && parsed.songId) {
        albumId = (await fetchAlbumIdBySong(parsed.storefront, parsed.songId, token)) ?? undefined;
        if (!albumId) {
          const res = jsonResponse({ hasMotion: false, videoUrl: null, colors: null }, 200, 3600);
          res.headers.set('X-Worker-Cache', 'MISS');
          ctx.waitUntil(cache.put(request, res.clone()));
          return res;
        }
      }

      if (!albumId) {
        return jsonResponse({ hasMotion: false, videoUrl: null, colors: null }, 200, 3600);
      }

      // 请求 amp-api 获取 1:1 动态封面
      const motion = await fetchSquareMotionArtwork(parsed.storefront, albumId, token);
      if (!motion || !motion.videoUrl) {
        const res = jsonResponse({
          hasMotion: false,
          videoUrl: null,
          colors: null,
        }, 200, 3600);
        res.headers.set('X-Worker-Cache', 'MISS');
        ctx.waitUntil(cache.put(request, res.clone()));
        return res;
      }

      const res = jsonResponse({
        hasMotion: true,
        videoUrl: motion.videoUrl,
        colors: motion.colors,
      }, 200, 86400);
      res.headers.set('X-Worker-Cache', 'MISS');
      ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch {
      return jsonResponse({
        hasMotion: false,
        videoUrl: null,
        colors: null,
      }, 500);
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

  const htmlResp = await fetch('https://music.apple.com', {
    headers: { 'User-Agent': USER_AGENT },
  });
  const html = await htmlResp.text();
  const jsMatch = html.match(/\/assets\/index~[^"']+\.js/);
  if (!jsMatch) throw new Error('No JS bundle');

  const jsResp = await fetch('https://music.apple.com' + jsMatch[0], {
    headers: { 'User-Agent': USER_AGENT },
  });
  const jsContent = await jsResp.text();
  const jwtMatch = jsContent.match(/eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+/);
  if (!jwtMatch) throw new Error('No JWT');

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

async function fetchAlbumIdBySong(
  storefront: string,
  songId: string,
  token: string
): Promise<string | null> {
  const endpoint = `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}?include=albums`;
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://music.apple.com',
      'User-Agent': USER_AGENT,
    },
  });
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    data?: Array<{
      relationships?: {
        albums?: {
          data?: Array<{ id?: string }>;
        };
      };
    }>;
  };
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
  const endpoint = `https://amp-api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?extend=editorialVideo`;
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: 'https://music.apple.com',
      'User-Agent': USER_AGENT,
    },
  });

  if (!resp.ok) {
    if (resp.status === 401) cachedToken = null;
    return null;
  }

  const result = (await resp.json()) as {
    data?: Array<{
      attributes?: {
        editorialVideo?: {
          motionDetailSquare?: EditorialVideoItem;
          motionSquareVideo1x1?: EditorialVideoItem;
        };
      };
    }>;
  };

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

function jsonResponse(
  data: Record<string, unknown> | MotionResult,
  status = 200,
  cacheTtl = 0
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };

  if (cacheTtl > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`;
  } else {
    headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
  }

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers,
  });
}
