import { useEffect, useState } from "react";

export type MotionArtworkResult = {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
};

const motionCache = new Map<string, MotionArtworkResult>();
const pendingRequests = new Map<string, Promise<MotionArtworkResult | null>>();

const MOTION_ENDPOINT = "https://am-motion-artwork.homepage.lyjw.llc/";

/**
 * 校验是否为合法的 Apple Music 资源地址（专辑 / 歌单 / 歌曲），过滤搜索页与空链接。
 */
function isValidAppleMusicUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return (
    url.startsWith("https://music.apple.com/") &&
    !url.includes("music.apple.com/search")
  );
}

export async function fetchMotionArtwork(
  url: string,
): Promise<MotionArtworkResult | null> {
  if (!isValidAppleMusicUrl(url)) return null;

  if (motionCache.has(url)) {
    return motionCache.get(url)!;
  }

  if (pendingRequests.has(url)) {
    return pendingRequests.get(url)!;
  }

  const promise = (async () => {
    try {
      const targetUrl = new URL(MOTION_ENDPOINT);
      targetUrl.searchParams.set("url", url);

      const response = await fetch(targetUrl.toString());

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as MotionArtworkResult;
      motionCache.set(url, data);
      return data;
    } catch {
      return null;
    } finally {
      pendingRequests.delete(url);
    }
  })();

  pendingRequests.set(url, promise);
  return promise;
}

/**
 * 当 hero 的 Apple Music 链接更新时，请求动态封面 API。
 */
export function useMotionArtwork(url: string | null | undefined): {
  data: MotionArtworkResult | null;
  isLoading: boolean;
} {
  const key = isValidAppleMusicUrl(url) ? url : null;
  /*
   * 结果连着它属于哪个 url 一起存。这样换歌时不用在 effect 里先把状态清一遍
   * ——「旧结果不作数」在渲染时比一下 url 就知道了，少一轮级联渲染。
   */
  const [resolved, setResolved] = useState<{
    url: string;
    result: MotionArtworkResult | null;
  } | null>(null);

  useEffect(() => {
    if (!key || motionCache.has(key)) return;

    let active = true;
    fetchMotionArtwork(key).then((result) => {
      if (active) setResolved({ url: key, result });
    });

    return () => {
      active = false;
    };
  }, [key]);

  if (!key) return { data: null, isLoading: false };

  const cached = motionCache.get(key);
  if (cached) return { data: cached, isLoading: false };

  // 请求回来了但没缓存（接口失败）：别再转圈，也别重试
  if (resolved?.url === key) return { data: resolved.result, isLoading: false };

  return { data: null, isLoading: true };
}
