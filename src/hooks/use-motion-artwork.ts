"use client";
import { backendUrl } from "@/lib/backend-url";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { useEffect, useState } from "react";

export type MotionArtworkResult = {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
};

const motionCache = new Map<string, MotionArtworkResult>();
const pendingRequests = new Map<string, Promise<MotionArtworkResult | null>>();

/**
 * 动态封面解析在 api Worker（workers/api/src/routes/motion-artwork）。
 * 按 `url=<链接>` 去问：卡片问的是 hero 那张，网页播放器问的是访客点开的那张。
 */
const MOTION_ENDPOINT = "/api/motion-artwork";

/**
 * 只问服务端解析得了的链接（目录专辑 / 单曲）。和路由共用 parseAppleMusicUrl：
 * 歌单（尤其私人歌单）、资料库条目、搜索页问了也只会拿到 400。
 */
function isValidAppleMusicUrl(url: string | null | undefined): url is string {
  return !!url && parseAppleMusicUrl(url) !== null;
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
      const response = await fetch(backendUrl(`${MOTION_ENDPOINT}?url=${encodeURIComponent(url)}`));

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        hasMotion: boolean;
        videoUrl: string | null;
        colors: string[] | null;
      };

      const result: MotionArtworkResult = {
        hasMotion: data.hasMotion,
        videoUrl: data.videoUrl,
        colors: data.colors,
      };

      motionCache.set(url, result);
      return result;
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
    // 接口失败（非 2xx / 网络错）不重试：同一个 url 已经有结果就不再问
    if (!key || motionCache.has(key) || resolved?.url === key) return;

    let active = true;
    fetchMotionArtwork(key).then((result) => {
      if (active) setResolved({ url: key, result });
    });

    return () => {
      active = false;
    };
  }, [key, resolved]);

  if (!key) return { data: null, isLoading: false };

  const cached = motionCache.get(key);
  if (cached) return { data: cached, isLoading: false };

  // 请求回来了但没缓存：接口失败不重试，也不转圈
  if (resolved?.url === key) return { data: resolved.result, isLoading: false };

  return { data: null, isLoading: true };
}
