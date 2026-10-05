import { cacheLife, cacheTag } from "next/cache";

import { backendUrl } from "@/lib/backend-url";
import type { LyricsResult } from "@/lib/lyrics";
import type { EndpointPayloadOf } from "@/lib/status-loaders";
import { STATUS_VIEWS, type StatusView, type StatusViewKey } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";

// 上游故障必须抛出以保留上一份首屏缓存；未部署端点的 404 才降级为空卡片。

const FETCH_TIMEOUT_MS = 20_000;

export const FIRST_SCREEN_CACHE_LIFE = { stale: 300, revalidate: 600, expire: 7 * 86400 } as const;

export type FirstScreen<K extends StatusViewKey> = StatusResponse<EndpointPayloadOf<K>>;

export async function firstScreen<K extends StatusViewKey>(key: K): Promise<FirstScreen<K>> {
  "use cache";
  cacheLife(FIRST_SCREEN_CACHE_LIFE);
  const view: StatusView = STATUS_VIEWS[key];
  if (view.tag) cacheTag(`page:${view.tag}`);
  const response = await fetch(backendUrl(view.path), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return { ok: false, error: "Status unavailable" };
  if (!response.ok) throw new Error(`First screen ${view.path}: ${response.status}`);
  return response.json();
}

export async function firstScreenLyrics(songId: string): Promise<LyricsResult | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  try {
    const response = await fetch(backendUrl(`/api/lyrics?song=${encodeURIComponent(songId)}`), {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as LyricsResult;
  } catch {
    return null;
  }
}
