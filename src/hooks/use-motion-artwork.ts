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

const MOTION_ENDPOINT = "/api/motion-artwork";

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

export function useMotionArtwork(url: string | null | undefined): {
  data: MotionArtworkResult | null;
  isLoading: boolean;
} {
  const key = isValidAppleMusicUrl(url) ? url : null;
  const [resolved, setResolved] = useState<{
    url: string;
    result: MotionArtworkResult | null;
  } | null>(null);

  useEffect(() => {
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

  if (resolved?.url === key) return { data: resolved.result, isLoading: false };

  return { data: null, isLoading: true };
}
